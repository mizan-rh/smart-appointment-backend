import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { DURATION_MAP } from '../services/dto';
import { ServicesService } from '../services/services.service';
import { StaffService } from '../staff/staff.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private db: DatabaseService,
    private staffService: StaffService,
    private servicesService: ServicesService,
  ) { }

  /* -------------------- CREATE APPOINTMENT -------------------- */
  async create(userId: string, dto: CreateAppointmentDto) {
    // Get service details
    const service = await this.servicesService.findOne(userId, dto.serviceId);
    const duration = DURATION_MAP[service.duration];

    // If staffId provided, validate assignment
    if (dto.staffId) {
      const validationResult = await this.validateStaffAssignment(
        userId,
        dto.staffId,
        service.requiredStaffType,
        dto.appointmentDate,
        dto.appointmentTime,
        duration,
      );

      if (!validationResult.canAssign) {
        throw new BadRequestException(validationResult.reason);
      }

      // Create appointment with staff
      const appointmentId = randomUUID();
      await this.db.query`
        INSERT INTO appointments (id, user_id, customer_name, service_id, staff_id, appointment_date, appointment_time, duration, status, updated_at)
        VALUES (
          ${appointmentId}, 
          ${userId}, 
          ${dto.customerName}, 
          ${dto.serviceId}, 
          ${dto.staffId}, 
          ${dto.appointmentDate.toISOString().split('T')[0]}, 
          ${dto.appointmentTime}, 
          ${duration}, 
          'SCHEDULED', 
          NOW()
        )
      `;

      const appointment = await this.findOne(userId, appointmentId);

      // Log activity
      await this.db.query`
        INSERT INTO activity_logs (id, user_id, action_type, description, appointment_id, staff_id)
        VALUES (${randomUUID()}, ${userId}, 'APPOINTMENT_ASSIGNED', ${`Appointment for "${dto.customerName}" assigned to ${appointment.staff?.name}`}, ${appointment.id}, ${dto.staffId})
      `;

      this.logger.log(`Appointment created and assigned: ${appointment.id}`);

      return appointment;
    }

    // No staff assigned - check if we should queue it
    const availableStaff = await this.staffService.getAvailableStaff(
      userId,
      service.requiredStaffType,
      dto.appointmentDate,
      dto.appointmentTime,
      duration,
    );

    const hasAvailableStaff = availableStaff.some((s) => s.isAvailable);

    if (!hasAvailableStaff) {
      // Add to queue
      const appointmentId = randomUUID();
      await this.db.query`
        INSERT INTO appointments (id, user_id, customer_name, service_id, appointment_date, appointment_time, duration, status, updated_at)
        VALUES (
          ${appointmentId}, 
          ${userId}, 
          ${dto.customerName}, 
          ${dto.serviceId}, 
          ${dto.appointmentDate.toISOString().split('T')[0]}, 
          ${dto.appointmentTime}, 
          ${duration}, 
          'IN_QUEUE', 
          NOW()
        )
      `;

      // Get next queue position
      const [{ count }] = await this.db.query`SELECT COUNT(*)::int as count FROM queue_entries`;

      await this.db.query`
        INSERT INTO queue_entries (id, appointment_id, queue_position)
        VALUES (${randomUUID()}, ${appointmentId}, ${count + 1})
      `;

      const appointment = await this.findOne(userId, appointmentId);

      // Log activity
      await this.db.query`
        INSERT INTO activity_logs (id, user_id, action_type, description, appointment_id)
        VALUES (${randomUUID()}, ${userId}, 'QUEUE_ADDED', ${`Appointment for "${dto.customerName}" added to waiting queue`}, ${appointment.id})
      `;

      this.logger.log(`Appointment added to queue: ${appointment.id}`);

      return appointment;
    }

    // Has available staff but user didn't select - return error with suggestions
    throw new BadRequestException({
      message: 'Staff assignment required',
      availableStaff: availableStaff
        .filter((s) => s.isAvailable)
        .map((s) => ({
          id: s.id,
          name: s.name,
          currentLoad: s.currentLoad,
          capacity: s.dailyCapacity,
          loadDisplay: `${s.name} (${s.currentLoad}/${s.dailyCapacity} appointments today)`,
        })),
    });
  }

  /* -------------------- VALIDATE STAFF ASSIGNMENT -------------------- */
  private async validateStaffAssignment(
    userId: string,
    staffId: string,
    requiredStaffType: string,
    date: Date,
    time: string,
    duration: number,
  ): Promise<{ canAssign: boolean; reason?: string }> {
    const staff = await this.staffService.findOne(userId, staffId);

    // Check service type match
    if (staff.serviceType !== requiredStaffType) {
      return {
        canAssign: false,
        reason: `Staff member is ${staff.serviceType}, but service requires ${requiredStaffType}`,
      };
    }

    // Check if staff is available
    if (staff.status !== 'AVAILABLE') {
      return {
        canAssign: false,
        reason: `${staff.name} is currently on leave`,
      };
    }

    // Check capacity
    const currentLoad = await this.staffService.getStaffLoadForDate(staffId, date);
    if (currentLoad >= staff.dailyCapacity) {
      return {
        canAssign: false,
        reason: `${staff.name} already has ${currentLoad} appointments today (capacity: ${staff.dailyCapacity})`,
      };
    }

    // Check time conflict
    const hasConflict = await this.staffService.checkTimeConflict(
      staffId,
      date,
      time,
      duration,
    );

    if (hasConflict) {
      return {
        canAssign: false,
        reason: `${staff.name} already has an appointment at this time`,
      };
    }

    return { canAssign: true };
  }

  /* -------------------- GET ALL APPOINTMENTS -------------------- */
  async findAll(userId: string, date?: Date, staffId?: string) {
    const params: any[] = [userId];
    let query = `
      SELECT a.*, 
             s.name as "serviceName", s.duration as "serviceDuration",
             st.name as "staffName", st.service_type as "staffServiceType",
             q.queue_position as "queuePosition"
      FROM appointments a
      LEFT JOIN services s ON a.service_id = s.id
      LEFT JOIN staff st ON a.staff_id = st.id
      LEFT JOIN queue_entries q ON a.id = q.appointment_id
      WHERE a.user_id = $1
    `;

    if (date) {
      params.push(date.toISOString().split('T')[0]);
      query += ` AND a.appointment_date = $${params.length}`;
    }

    if (staffId) {
      params.push(staffId);
      query += ` AND a.staff_id = $${params.length}`;
    }

    query += ` ORDER BY a.appointment_date ASC, a.appointment_time ASC`;

    const appointments = await this.db.raw(query, params);

    return appointments.map((a: any) => this.mapAppointmentResponse(a));
  }

  /* -------------------- GET APPOINTMENT BY ID -------------------- */
  async findOne(userId: string, appointmentId: string) {
    const [appointment] = await this.db.query`
      SELECT a.*, 
             s.name as "serviceName", s.duration as "serviceDuration",
             st.name as "staffName", st.service_type as "staffServiceType",
             q.queue_position as "queuePosition"
      FROM appointments a
      LEFT JOIN services s ON a.service_id = s.id
      LEFT JOIN staff st ON a.staff_id = st.id
      LEFT JOIN queue_entries q ON a.id = q.appointment_id
      WHERE a.id = ${appointmentId} AND a.user_id = ${userId}
    `;

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    return this.mapAppointmentResponse(appointment);
  }

  /* -------------------- UPDATE APPOINTMENT -------------------- */
  async update(userId: string, appointmentId: string, dto: UpdateAppointmentDto) {
    const existing = await this.findOne(userId, appointmentId);

    // If changing staff or time, validate
    if (dto.staffId || dto.appointmentTime || dto.appointmentDate) {
      const service = await this.servicesService.findOne(
        userId,
        dto.serviceId || existing.service.id,
      );
      const duration = DURATION_MAP[service.duration as keyof typeof DURATION_MAP] || existing.duration;

      if (dto.staffId) {
        const validationResult = await this.validateStaffAssignment(
          userId,
          dto.staffId,
          service.requiredStaffType,
          dto.appointmentDate || existing.appointmentDate,
          dto.appointmentTime || existing.appointmentTime,
          duration,
        );

        if (!validationResult.canAssign) {
          throw new BadRequestException(validationResult.reason);
        }
      }
    }

    const [updated] = await this.db.query`
      UPDATE appointments
      SET customer_name = COALESCE(${dto.customerName}, customer_name),
          service_id = COALESCE(${dto.serviceId}, service_id),
          staff_id = COALESCE(${dto.staffId}, staff_id),
          appointment_date = COALESCE(${dto.appointmentDate ? dto.appointmentDate.toISOString().split('T')[0] : null}, appointment_date),
          appointment_time = COALESCE(${dto.appointmentTime}, appointment_time),
          status = COALESCE(${dto.status}, status),
          updated_at = NOW()
      WHERE id = ${appointmentId}
      RETURNING *
    `;

    // Log activity
    await this.db.query`
      INSERT INTO activity_logs (id, user_id, action_type, description, appointment_id, staff_id)
      VALUES (${randomUUID()}, ${userId}, 'APPOINTMENT_UPDATED', ${`Appointment for "${updated.customer_name}" updated`}, ${updated.id}, ${updated.staff_id})
    `;

    this.logger.log(`Appointment updated: ${appointmentId}`);

    return this.findOne(userId, appointmentId);
  }

  /* -------------------- CANCEL APPOINTMENT -------------------- */
  async cancel(userId: string, appointmentId: string) {
    const appointment = await this.findOne(userId, appointmentId);

    await this.db.query`
      UPDATE appointments SET status = 'CANCELLED', updated_at = NOW() WHERE id = ${appointmentId}
    `;

    // If in queue, remove from queue
    if (appointment.inQueue) {
      await this.db.query`DELETE FROM queue_entries WHERE appointment_id = ${appointmentId}`;

      // Reorder queue
      await this.reorderQueue();
    }

    // Log activity
    await this.db.query`
      INSERT INTO activity_logs (id, user_id, action_type, description, appointment_id)
      VALUES (${randomUUID()}, ${userId}, 'APPOINTMENT_CANCELLED', ${`Appointment for "${appointment.customerName}" cancelled`}, ${appointmentId})
    `;

    this.logger.log(`Appointment cancelled: ${appointmentId}`);

    return { message: 'Appointment cancelled successfully' };
  }

  /* -------------------- HELPER: REORDER QUEUE -------------------- */
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

  /* -------------------- HELPER: MAP RESPONSE -------------------- */
  private mapAppointmentResponse(appointment: any) {
    return {
      id: appointment.id,
      customerName: appointment.customer_name || appointment.customerName,
      service: {
        id: appointment.service_id || appointment.serviceId,
        name: appointment.serviceName,
        duration: appointment.serviceDuration,
      },
      staff: (appointment.staff_id || appointment.staffId)
        ? {
          id: appointment.staff_id || appointment.staffId,
          name: appointment.staffName,
          serviceType: appointment.staffServiceType,
        }
        : undefined,
      appointmentDate: appointment.appointment_date || appointment.appointmentDate,
      appointmentTime: appointment.appointment_time || appointment.appointmentTime,
      duration: appointment.duration,
      status: appointment.status,
      inQueue: !!appointment.queuePosition,
      queuePosition: appointment.queuePosition,
      createdAt: appointment.created_at || appointment.createdAt,
    };
  }
}