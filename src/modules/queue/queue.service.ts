import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { formatDistanceToNow } from 'date-fns';
import { PrismaService } from '../../database/prisma.service';
import { DURATION_MAP } from '../services/dto';
import { ServicesService } from '../services/services.service';
import { StaffService } from '../staff/staff.service';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    private prisma: PrismaService,
    private staffService: StaffService,
    private servicesService: ServicesService,
  ) { }

  /* -------------------- GET QUEUE -------------------- */
  async getQueue(userId: string) {
    const queueEntries = await this.prisma.queueEntry.findMany({
      include: {
        appointment: {
          include: {
            service: true,
          },
        },
      },
      orderBy: { queuePosition: 'asc' },
    });

    // Filter by user
    const userQueue = queueEntries.filter(
      (q) => q.appointment.userId === userId,
    );

    return userQueue.map((q) => this.mapQueueEntryResponse(q));
  }

  /* -------------------- MANUAL ASSIGN FROM QUEUE -------------------- */
  async assignFromQueue(userId: string, queueEntryId: string, staffId: string) {
    const queueEntry = await this.prisma.queueEntry.findUnique({
      where: { id: queueEntryId },
      include: {
        appointment: {
          include: {
            service: true,
          },
        },
      },
    });

    if (!queueEntry) {
      throw new NotFoundException('Queue entry not found');
    }

    const appointment = queueEntry.appointment;

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
      appointment.appointmentDate,
      appointment.appointmentTime,
      duration,
    );

    if (!validationResult.canAssign) {
      throw new BadRequestException(validationResult.reason);
    }

    // Assign staff and remove from queue
    const updated = await this.prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        staffId,
        status: 'SCHEDULED',
      },
      include: {
        staff: true,
      },
    });

    // Remove from queue
    await this.prisma.queueEntry.delete({
      where: { id: queueEntryId },
    });

    // Reorder remaining queue
    await this.reorderQueue();

    // Log activity
    await this.prisma.activityLog.create({
      data: {
        userId,
        actionType: 'QUEUE_ASSIGNED',
        description: `Appointment for "${appointment.customerName}" assigned to ${updated.staff?.name} from queue`,
        appointmentId: appointment.id,
        staffId,
      },
    });

    this.logger.log(
      `Queue entry ${queueEntryId} assigned to staff ${staffId}`,
    );

    return {
      message: 'Appointment assigned successfully',
      appointment: updated,
    };
  }

  /* -------------------- AUTO-ASSIGN ALL (CRON + MANUAL) -------------------- */
  async autoAssignAll(userId: string) {
    const queueEntries = await this.prisma.queueEntry.findMany({
      include: {
        appointment: {
          include: {
            service: true,
          },
        },
      },
      orderBy: { queuePosition: 'asc' },
    });

    // Filter by user
    const userQueue = queueEntries.filter(
      (q) => q.appointment.userId === userId,
    );

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
      const appointment = queueEntry.appointment;
      const service = await this.servicesService.findOne(userId, appointment.serviceId);
      const duration = DURATION_MAP[service.duration];

      // Find available staff
      const availableStaff = await this.staffService.getAvailableStaff(
        userId,
        service.requiredStaffType,
        appointment.appointmentDate,
        appointment.appointmentTime,
        duration,
      );

      const eligibleStaff = availableStaff.find((s) => s.isAvailable);

      if (eligibleStaff) {
        try {
          // Assign to first available staff
          await this.prisma.appointment.update({
            where: { id: appointment.id },
            data: {
              staffId: eligibleStaff.id,
              status: 'SCHEDULED',
            },
          });

          // Remove from queue
          await this.prisma.queueEntry.delete({
            where: { id: queueEntry.id },
          });

          // Log activity
          await this.prisma.activityLog.create({
            data: {
              userId,
              actionType: 'QUEUE_ASSIGNED',
              description: `Appointment for "${appointment.customerName}" auto-assigned to ${eligibleStaff.name}`,
              appointmentId: appointment.id,
              staffId: eligibleStaff.id,
            },
          });

          results.push({
            appointmentId: appointment.id,
            customerName: appointment.customerName,
            success: true,
            staffAssigned: eligibleStaff.name,
          });

          assigned++;
          this.logger.log(
            `Auto-assigned: ${appointment.customerName} → ${eligibleStaff.name}`,
          );
        } catch (error) {
          results.push({
            appointmentId: appointment.id,
            customerName: appointment.customerName,
            success: false,
            reason: 'Assignment failed',
          });
          failed++;
        }
      } else {
        results.push({
          appointmentId: appointment.id,
          customerName: appointment.customerName,
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
      const queueEntries = await this.prisma.queueEntry.findMany({
        include: {
          appointment: true,
        },
      });

      const userIds = [...new Set(queueEntries.map((q) => q.appointment.userId))];

      for (const userId of userIds) {
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
    const queueEntries = await this.prisma.queueEntry.findMany({
      orderBy: { addedAt: 'asc' },
    });

    for (let i = 0; i < queueEntries.length; i++) {
      await this.prisma.queueEntry.update({
        where: { id: queueEntries[i].id },
        data: { queuePosition: i + 1 },
      });
    }
  }

  /* -------------------- MAP QUEUE ENTRY RESPONSE -------------------- */
  private mapQueueEntryResponse(queueEntry: any) {
    const waitingTime = formatDistanceToNow(queueEntry.addedAt, {
      addSuffix: true,
    });

    return {
      id: queueEntry.id,
      queuePosition: queueEntry.queuePosition,
      appointment: {
        id: queueEntry.appointment.id,
        customerName: queueEntry.appointment.customerName,
        service: {
          id: queueEntry.appointment.service.id,
          name: queueEntry.appointment.service.name,
          duration: DURATION_MAP[queueEntry.appointment.service.duration],
          requiredStaffType: queueEntry.appointment.service.requiredStaffType,
        },
        appointmentDate: queueEntry.appointment.appointmentDate,
        appointmentTime: queueEntry.appointment.appointmentTime,
      },
      addedAt: queueEntry.addedAt,
      waitingTime,
    };
  }
}