import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { formatDistanceToNow } from 'date-fns';
import { DatabaseService } from '../../database/database.service';
import { DURATION_MAP } from '../services/dto';
import { ServicesService } from '../services/services.service';
import { StaffService } from '../staff/staff.service';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private db: DatabaseService,
    private staffService: StaffService,
    private servicesService: ServicesService,
  ) { }

  /* -------------------- GET QUEUE -------------------- */
  async getQueue(userId: string) {
    const queueEntries = await this.db.query`
      SELECT q.*, 
             a.customer_name as "customerName", a.appointment_date as "appointmentDate", 
             a.appointment_time as "appointmentTime", a.service_id as "serviceId",
             s.name as "serviceName", s.duration as "serviceDuration", s.required_staff_type as "requiredStaffType"
      FROM queue_entries q
      JOIN appointments a ON q.appointment_id = a.id
      JOIN services s ON a.service_id = s.id
      WHERE a.user_id = ${userId}
      ORDER BY q.queue_position ASC
    `;

    return queueEntries.map((q: any) => this.mapQueueEntryResponse(q));
  }

  /* -------------------- MANUAL ASSIGN FROM QUEUE -------------------- */
  async assignFromQueue(userId: string, queueEntryId: string, staffId: string) {
    const [queueEntry] = await this.db.query`
      SELECT q.*, a.id as "appointmentId", a.user_id as "userId", a.service_id as "serviceId",
             a.appointment_date as "appointmentDate", a.appointment_time as "appointmentTime"
      FROM queue_entries q
      JOIN appointments a ON q.appointment_id = a.id
      WHERE q.id = ${queueEntryId}
    `;

    if (!queueEntry) {
      throw new NotFoundException('Queue entry not found');
    }

    const appointment = queueEntry;

    if (appointment.userId !== userId) {
      throw new BadRequestException('Unauthorized');
    }

    // Validate staff assignment
    const service = await this.servicesService.findOne(userId, appointment.serviceId);
    const duration = DURATION_MAP[service.duration];

    const validationResult = await this.validateStaffForAppointment(
      userId,
      staffId,
      service.requiredStaffType,
      new Date(appointment.appointmentDate),
      appointment.appointmentTime,
      duration,
    );

    if (!validationResult.canAssign) {
      throw new BadRequestException(validationResult.reason);
    }

    // Assign staff and remove from queue
    await this.db.query`
      UPDATE appointments 
      SET staff_id = ${staffId}, status = 'SCHEDULED', updated_at = NOW()
      WHERE id = ${appointment.appointmentId}
    `;

    // Remove from queue
    await this.db.query`DELETE FROM queue_entries WHERE id = ${queueEntryId}`;

    // Reorder remaining queue
    await this.reorderQueue();

    // Log activity
    await this.db.query`
      INSERT INTO activity_logs (id, user_id, action_type, description, appointment_id, staff_id)
      VALUES (${randomUUID()}, ${userId}, 'QUEUE_ASSIGNED', ${`Appointment assigned from queue`}, ${appointment.appointmentId}, ${staffId})
    `;

    this.logger.log(
      `Queue entry ${queueEntryId} assigned to staff ${staffId}`,
    );

    const [result] = await this.db.query`
      SELECT a.* FROM appointments a WHERE a.id = ${appointment.appointmentId}
    `;

    return {
      message: 'Appointment assigned successfully',
      appointment: result,
    };
  }

  /* -------------------- AUTO-ASSIGN ALL (CRON + MANUAL) -------------------- */
  async autoAssignAll(userId: string) {
    const userQueue = await this.db.query`
      SELECT q.*, a.id as "appointmentId", a.customer_name as "customerName",
             a.appointment_date as "appointmentDate", a.appointment_time as "appointmentTime",
             a.service_id as "serviceId",
             s.required_staff_type as "requiredStaffType", s.duration as "serviceDuration"
      FROM queue_entries q
      JOIN appointments a ON q.appointment_id = a.id
      JOIN services s ON a.service_id = s.id
      WHERE a.user_id = ${userId}
      ORDER BY q.queue_position ASC
    `;

    const results: Array<{
      appointmentId: string;
      customerName: string;
      success: boolean;
      staffAssigned?: string;
      reason?: string;
    }> = [];
    let assigned = 0;
    let failed = 0;

    for (const queueEntry of userQueue) {
      const duration = DURATION_MAP[queueEntry.serviceDuration as keyof typeof DURATION_MAP];

      // Find available staff
      const availableStaff = await this.staffService.getAvailableStaff(
        userId,
        queueEntry.requiredStaffType,
        new Date(queueEntry.appointmentDate),
        queueEntry.appointmentTime,
        duration,
      );

      const eligibleStaff = availableStaff.find((s) => s.isAvailable);

      if (eligibleStaff) {
        try {
          // Assign to first available staff
          await this.db.query`
            UPDATE appointments 
            SET staff_id = ${eligibleStaff.id}, status = 'SCHEDULED', updated_at = NOW()
            WHERE id = ${queueEntry.appointmentId}
          `;

          // Remove from queue
          await this.db.query`DELETE FROM queue_entries WHERE id = ${queueEntry.id}`;

          // Log activity
          await this.db.query`
            INSERT INTO activity_logs (id, user_id, action_type, description, appointment_id, staff_id)
            VALUES (${randomUUID()}, ${userId}, 'QUEUE_ASSIGNED', ${`Appointment for "${queueEntry.customerName}" auto-assigned to ${eligibleStaff.name}`}, ${queueEntry.appointmentId}, ${eligibleStaff.id})
          `;

          results.push({
            appointmentId: queueEntry.appointmentId,
            customerName: queueEntry.customerName,
            success: true,
            staffAssigned: eligibleStaff.name,
          });

          assigned++;
          this.logger.log(
            `Auto-assigned: ${queueEntry.customerName} → ${eligibleStaff.name}`,
          );
        } catch (error) {
          results.push({
            appointmentId: queueEntry.appointmentId,
            customerName: queueEntry.customerName,
            success: false,
            reason: 'Assignment failed',
          });
          failed++;
        }
      } else {
        results.push({
          appointmentId: queueEntry.appointmentId,
          customerName: queueEntry.customerName,
          success: false,
          reason: 'No available staff',
        });
        failed++;
      }
    }

    // Reorder remaining queue
    await this.reorderQueue();

    this.logger.log(
      `Auto-assign completed: ${assigned} assigned, ${failed} failed`,
    );

    return {
      assigned,
      failed,
      results,
    };
  }

  /* -------------------- CRON JOB: AUTO-ASSIGN EVERY 5 MINUTES -------------------- */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleAutoAssignCron() {
    this.logger.log('Running auto-assign cron job...');

    try {
      // Get all users with queue entries
      const userIds = await this.db.query`
        SELECT DISTINCT a.user_id as "userId"
        FROM queue_entries q
        JOIN appointments a ON q.appointment_id = a.id
      `;

      for (const { userId } of userIds) {
        await this.autoAssignAll(userId);
      }

      this.logger.log('Auto-assign cron job completed');
    } catch (error) {
      this.logger.error('Auto-assign cron job failed', error);
    }
  }

  /* -------------------- VALIDATE STAFF FOR APPOINTMENT -------------------- */
  private async validateStaffForAppointment(
    userId: string,
    staffId: string,
    requiredStaffType: string,
    date: Date,
    time: string,
    duration: number,
  ): Promise<{ canAssign: boolean; reason?: string }> {
    const staff = await this.staffService.findOne(userId, staffId);

    if (staff.serviceType !== requiredStaffType) {
      return {
        canAssign: false,
        reason: `Staff type mismatch: ${staff.serviceType} vs ${requiredStaffType}`,
      };
    }

    if (staff.status !== 'AVAILABLE') {
      return { canAssign: false, reason: 'Staff is on leave' };
    }

    const currentLoad = await this.staffService.getStaffLoadForDate(staffId, date);
    if (currentLoad >= staff.dailyCapacity) {
      return {
        canAssign: false,
        reason: `Staff at capacity: ${currentLoad}/${staff.dailyCapacity}`,
      };
    }

    const hasConflict = await this.staffService.checkTimeConflict(
      staffId,
      date,
      time,
      duration,
    );

    if (hasConflict) {
      return { canAssign: false, reason: 'Time conflict' };
    }

    return { canAssign: true };
  }

  /* -------------------- REORDER QUEUE -------------------- */
  private async reorderQueue() {
    const queueEntries = await this.db.query`
      SELECT id FROM queue_entries ORDER BY added_at ASC
    `;

    for (let i = 0; i < queueEntries.length; i++) {
      await this.db.query`
        UPDATE queue_entries SET queue_position = ${i + 1} WHERE id = ${queueEntries[i].id}
      `;
    }
  }

  /* -------------------- MAP QUEUE ENTRY RESPONSE -------------------- */
  private mapQueueEntryResponse(queueEntry: any) {
    const waitingTime = formatDistanceToNow(new Date(queueEntry.added_at || queueEntry.addedAt), {
      addSuffix: true,
    });

    return {
      id: queueEntry.id,
      queuePosition: queueEntry.queue_position || queueEntry.queuePosition,
      appointment: {
        id: queueEntry.appointment_id || queueEntry.appointmentId,
        customerName: queueEntry.customerName,
        service: {
          id: queueEntry.serviceId,
          name: queueEntry.serviceName,
          duration: DURATION_MAP[queueEntry.serviceDuration as keyof typeof DURATION_MAP],
          requiredStaffType: queueEntry.requiredStaffType,
        },
        appointmentDate: queueEntry.appointmentDate,
        appointmentTime: queueEntry.appointmentTime,
      },
      addedAt: queueEntry.added_at || queueEntry.addedAt,
      waitingTime,
    };
  }
}