import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StaffService } from '../staff/staff.service';
import { ServicesService } from '../services/services.service';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto';
import { DURATION_MAP } from '../services/dto';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private prisma: PrismaService,
    private staffService: StaffService,
    private servicesService: ServicesService,
  ) {}

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
      const appointment = await this.prisma.appointment.create({
        data: {
          userId,
          customerName: dto.customerName,
          serviceId: dto.serviceId,
          staffId: dto.staffId,
          appointmentDate: dto.appointmentDate,
          appointmentTime: dto.appointmentTime,
          duration,
          status: 'SCHEDULED',
        },
        include: {
          service: true,
          staff: true,
        },
      });

      // Log activity
      await this.prisma.activityLog.create({
        data: {
          userId,
          actionType: 'APPOINTMENT_ASSIGNED',
          description: `Appointment for "${dto.customerName}" assigned to ${appointment.staff?.name}`,
          appointmentId: appointment.id,
          staffId: dto.staffId,
        },
      });

      this.logger.log(`Appointment created and assigned: ${appointment.id}`);

      return this.mapAppointmentResponse(appointment);
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
      const appointment = await this.prisma.appointment.create({
        data: {
          userId,
          customerName: dto.customerName,
          serviceId: dto.serviceId,
          appointmentDate: dto.appointmentDate,
          appointmentTime: dto.appointmentTime,
          duration,
          status: 'IN_QUEUE',
        },
        include: {
          service: true,
        },
      });

      // Get next queue position
      const queueCount = await this.prisma.queueEntry.count();

      await this.prisma.queueEntry.create({
        data: {
          appointmentId: appointment.id,
          queuePosition: queueCount + 1,
        },
      });

      // Log activity
      await this.prisma.activityLog.create({
        data: {
          userId,
          actionType: 'QUEUE_ADDED',
          description: `Appointment for "${dto.customerName}" added to waiting queue`,
          appointmentId: appointment.id,
        },
      });

      this.logger.log(`Appointment added to queue: ${appointment.id}`);

      return this.mapAppointmentResponse(appointment);
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
    const where: any = { userId };

    if (date) {
      where.appointmentDate = date;
    }

    if (staffId) {
      where.staffId = staffId;
    }

    const appointments = await this.prisma.appointment.findMany({
      where,
      include: {
        service: true,
        staff: true,
        queue: true,
      },
      orderBy: [{ appointmentDate: 'asc' }, { appointmentTime: 'asc' }],
    });

    return appointments.map((a) => this.mapAppointmentResponse(a));
  }

  /* -------------------- GET APPOINTMENT BY ID -------------------- */
  async findOne(userId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, userId },
      include: {
        service: true,
        staff: true,
        queue: true,
      },
    });

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
      const duration = DURATION_MAP[service.duration];

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

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: dto,
      include: {
        service: true,
        staff: true,
        queue: true,
      },
    });

    // Log activity
    await this.prisma.activityLog.create({
      data: {
        userId,
        actionType: 'APPOINTMENT_UPDATED',
        description: `Appointment for "${updated.customerName}" updated`,
        appointmentId: updated.id,
        staffId: updated.staffId,
      },
    });

    this.logger.log(`Appointment updated: ${appointmentId}`);

    return this.mapAppointmentResponse(updated);
  }

  /* -------------------- CANCEL APPOINTMENT -------------------- */
  async cancel(userId: string, appointmentId: string) {
    const appointment = await this.findOne(userId, appointmentId);

    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELLED' },
    });

    // If in queue, remove from queue
    if (appointment.inQueue) {
      await this.prisma.queueEntry.delete({
        where: { appointmentId },
      });

      // Reorder queue
      await this.reorderQueue();
    }

    // Log activity
    await this.prisma.activityLog.create({
      data: {
        userId,
        actionType: 'APPOINTMENT_CANCELLED',
        description: `Appointment for "${appointment.customerName}" cancelled`,
        appointmentId,
      },
    });

    this.logger.log(`Appointment cancelled: ${appointmentId}`);

    return { message: 'Appointment cancelled successfully' };
  }

  /* -------------------- HELPER: REORDER QUEUE -------------------- */
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

  /* -------------------- HELPER: MAP RESPONSE -------------------- */
  private mapAppointmentResponse(appointment: any) {
    return {
      id: appointment.id,
      customerName: appointment.customerName,
      service: {
        id: appointment.service.id,
        name: appointment.service.name,
        duration: DURATION_MAP[appointment.service.duration],
      },
      staff: appointment.staff
        ? {
            id: appointment.staff.id,
            name: appointment.staff.name,
            serviceType: appointment.staff.serviceType,
          }
        : undefined,
      appointmentDate: appointment.appointmentDate,
      appointmentTime: appointment.appointmentTime,
      duration: appointment.duration,
      status: appointment.status,
      inQueue: !!appointment.queue,
      queuePosition: appointment.queue?.queuePosition,
      createdAt: appointment.createdAt,
    };
  }
}