import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { CreateServiceDto, DURATION_MAP, UpdateServiceDto } from './dto';

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(private db: DatabaseService) { }

  /* -------------------- CREATE SERVICE -------------------- */
  async create(userId: string, dto: CreateServiceDto) {
    const serviceId = randomUUID();
    const [service] = await this.db.query`
      INSERT INTO services (id, user_id, name, duration, required_staff_type, updated_at)
      VALUES (${serviceId}, ${userId}, ${dto.name}, ${dto.duration}, ${dto.requiredStaffType}, NOW())
      RETURNING *
    `;

    // Log activity
    await this.db.query`
      INSERT INTO activity_logs (id, user_id, action_type, description)
      VALUES (${randomUUID()}, ${userId}, 'SERVICE_CREATED', ${`Service "${service.name}" created`})
    `;

    this.logger.log(`Service created: ${service.name}`);

    return this.mapServiceResponse(service);
  }

  /* -------------------- GET ALL SERVICES -------------------- */
  async findAll(userId: string) {
    const services = await this.db.query`
      SELECT id, user_id as "userId", name, duration, required_staff_type as "requiredStaffType",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM services
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;

    return services.map((s: any) => this.mapServiceResponse(s));
  }

  /* -------------------- GET SERVICE BY ID -------------------- */
  async findOne(userId: string, serviceId: string) {
    const [service] = await this.db.query`
      SELECT id, user_id as "userId", name, duration, required_staff_type as "requiredStaffType",
             created_at as "createdAt", updated_at as "updatedAt"
      FROM services
      WHERE id = ${serviceId} AND user_id = ${userId}
    `;

    if (!service) {
      throw new NotFoundException('Service not found');
    }

    return this.mapServiceResponse(service);
  }

  /* -------------------- UPDATE SERVICE -------------------- */
  async update(userId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.findOne(userId, serviceId);

    const [updated] = await this.db.query`
      UPDATE services
      SET name = COALESCE(${dto.name}, name),
          duration = COALESCE(${dto.duration}, duration),
          required_staff_type = COALESCE(${dto.requiredStaffType}, required_staff_type),
          updated_at = NOW()
      WHERE id = ${serviceId}
      RETURNING *
    `;

    this.logger.log(`Service updated: ${updated.name}`);

    return this.mapServiceResponse({
      ...updated,
      userId: updated.user_id,
      requiredStaffType: updated.required_staff_type,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at
    });
  }

  /* -------------------- DELETE SERVICE -------------------- */
  async remove(userId: string, serviceId: string) {
    const service = await this.findOne(userId, serviceId);

    // Check if service has upcoming appointments
    const [result] = await this.db.query`
      SELECT COUNT(*)::int as count
      FROM appointments
      WHERE service_id = ${serviceId} AND appointment_date >= NOW() AND status = 'SCHEDULED'
    `;

    if (result.count > 0) {
      throw new BadRequestException(
        `Cannot delete service with ${result.count} upcoming appointments`,
      );
    }

    await this.db.query`DELETE FROM services WHERE id = ${serviceId}`;

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