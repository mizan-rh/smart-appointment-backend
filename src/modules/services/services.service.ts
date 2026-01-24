import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateServiceDto, UpdateServiceDto, DURATION_MAP } from './dto';

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(private prisma: PrismaService) {}

  /* -------------------- CREATE SERVICE -------------------- */
  async create(userId: string, dto: CreateServiceDto) {
    const service = await this.prisma.service.create({
      data: {
        userId,
        name: dto.name,
        duration: dto.duration,
        requiredStaffType: dto.requiredStaffType,
      },
    });

    // Log activity
    await this.prisma.activityLog.create({
      data: {
        userId,
        actionType: 'SERVICE_CREATED',
        description: `Service "${service.name}" created`,
      },
    });

    this.logger.log(`Service created: ${service.name}`);

    return this.mapServiceResponse(service);
  }

  /* -------------------- GET ALL SERVICES -------------------- */
  async findAll(userId: string) {
    const services = await this.prisma.service.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return services.map((s) => this.mapServiceResponse(s));
  }

  /* -------------------- GET SERVICE BY ID -------------------- */
  async findOne(userId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, userId },
    });

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return this.mapServiceResponse(service);
  }

  /* -------------------- UPDATE SERVICE -------------------- */
  async update(userId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.findOne(userId, serviceId);

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: dto,
    });

    this.logger.log(`Service updated: ${updated.name}`);

    return this.mapServiceResponse(updated);
  }

  /* -------------------- DELETE SERVICE -------------------- */
  async remove(userId: string, serviceId: string) {
    const service = await this.findOne(userId, serviceId);

    // Check if service has upcoming appointments
    const upcomingAppointments = await this.prisma.appointment.count({
      where: {
        serviceId,
        appointmentDate: { gte: new Date() },
        status: 'SCHEDULED',
      },
    });

    if (upcomingAppointments > 0) {
      throw new BadRequestException(
        `Cannot delete service with ${upcomingAppointments} upcoming appointments`,
      );
    }

    await this.prisma.service.delete({
      where: { id: serviceId },
    });

    this.logger.log(`Service deleted: ${service.name}`);

    return { message: 'Service deleted successfully' };
  }

  /* -------------------- HELPER: MAP RESPONSE -------------------- */
  private mapServiceResponse(service: any) {
    return {
      ...service,
      durationMinutes: DURATION_MAP[service.duration],
    };
  }
}