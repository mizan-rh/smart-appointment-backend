import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../../database/database.service';
import { CreateStaffDto, UpdateStaffDto } from './dto';

@Injectable()
export class StaffService {
    private readonly logger = new Logger(StaffService.name);

    constructor(private db: DatabaseService) { }

    /* -------------------- CREATE STAFF -------------------- */
    async create(userId: string, dto: CreateStaffDto) {
        const staffId = randomUUID();
        const [staff] = await this.db.query`
            INSERT INTO staff (id, user_id, name, service_type, daily_capacity, status, updated_at)
            VALUES (${staffId}, ${userId}, ${dto.name}, ${dto.serviceType}, ${dto.dailyCapacity || 5}, ${dto.status}, NOW())
            RETURNING *
        `;

        // Log activity
        await this.db.query`
            INSERT INTO activity_logs (id, user_id, action_type, description, staff_id)
            VALUES (${randomUUID()}, ${userId}, 'STAFF_CREATED', ${`Staff member "${staff.name}" created`}, ${staff.id})
        `;

        this.logger.log(`Staff created: ${staff.name} (${staff.serviceType})`);

        return staff;
    }

    /* -------------------- GET ALL STAFF -------------------- */
    async findAll(userId: string, date?: Date) {
        const staff = await this.db.query`
            SELECT id, user_id as "userId", name, service_type as "serviceType", 
                   daily_capacity as "dailyCapacity", status, created_at as "createdAt", 
                   updated_at as "updatedAt"
            FROM staff
            WHERE user_id = ${userId}
            ORDER BY created_at DESC
        `;

        // If date provided, calculate current load
        if (date) {
            const staffWithLoad = await Promise.all(
                staff.map(async (s: any) => {
                    const currentLoad = await this.getStaffLoadForDate(s.id, date);
                    return {
                        ...s,
                        currentLoad,
                        availableSlots: s.dailyCapacity - currentLoad,
                    };
                }),
            );
            return staffWithLoad;
        }

        return staff;
    }

    /* -------------------- GET STAFF BY ID -------------------- */
    async findOne(userId: string, staffId: string) {
        const [staff] = await this.db.query`
            SELECT id, user_id as "userId", name, service_type as "serviceType", 
                   daily_capacity as "dailyCapacity", status, created_at as "createdAt", 
                   updated_at as "updatedAt"
            FROM staff
            WHERE id = ${staffId} AND user_id = ${userId}
        `;

        if (!staff) {
            throw new NotFoundException('Staff member not found');
        }

        return staff;
    }

    /* -------------------- UPDATE STAFF -------------------- */
    async update(userId: string, staffId: string, dto: UpdateStaffDto) {
        await this.findOne(userId, staffId);

        // This is a simplified update, usually we'd build the query dynamically
        // but for now let's use a clear approach
        const [updated] = await this.db.query`
            UPDATE staff
            SET name = COALESCE(${dto.name}, name),
                service_type = COALESCE(${dto.serviceType}, service_type),
                daily_capacity = COALESCE(${dto.dailyCapacity}, daily_capacity),
                status = COALESCE(${dto.status}, status),
                updated_at = NOW()
            WHERE id = ${staffId}
            RETURNING *
        `;

        // Log activity
        await this.db.query`
            INSERT INTO activity_logs (id, user_id, action_type, description, staff_id)
            VALUES (${randomUUID()}, ${userId}, 'STAFF_UPDATED', ${`Staff member "${updated.name}" updated`}, ${updated.id})
        `;

        this.logger.log(`Staff updated: ${updated.name}`);

        return {
            ...updated,
            userId: updated.user_id,
            serviceType: updated.service_type,
            dailyCapacity: updated.daily_capacity,
            createdAt: updated.created_at,
            updatedAt: updated.updated_at
        };
    }

    /* -------------------- DELETE STAFF -------------------- */
    async remove(userId: string, staffId: string) {
        const staff = await this.findOne(userId, staffId);

        // Check if staff has upcoming appointments
        const [result] = await this.db.query`
            SELECT COUNT(*)::int as count 
            FROM appointments
            WHERE staff_id = ${staffId} AND appointment_date >= NOW() AND status = 'SCHEDULED'
        `;

        if (result.count > 0) {
            throw new BadRequestException(
                `Cannot delete staff with ${result.count} upcoming appointments`,
            );
        }

        await this.db.query`DELETE FROM staff WHERE id = ${staffId}`;

        this.logger.log(`Staff deleted: ${staff.name}`);

        return { message: 'Staff member deleted successfully' };
    }

    /* -------------------- GET AVAILABLE STAFF -------------------- */
    async getAvailableStaff(
        userId: string,
        serviceType: string,
        date: Date,
        time: string,
        duration: number,
    ) {
        const staff = await this.db.query`
            SELECT id, user_id as "userId", name, service_type as "serviceType", 
                   daily_capacity as "dailyCapacity", status, created_at as "createdAt", 
                   updated_at as "updatedAt"
            FROM staff
            WHERE user_id = ${userId} AND service_type = ${serviceType} AND status = 'AVAILABLE'
        `;

        const availableStaff = await Promise.all(
            staff.map(async (s: any) => {
                const currentLoad = await this.getStaffLoadForDate(s.id, date);
                const hasConflict = await this.checkTimeConflict(s.id, date, time, duration);

                return {
                    ...s,
                    currentLoad,
                    availableSlots: s.dailyCapacity - currentLoad,
                    hasConflict,
                    isAvailable: currentLoad < s.dailyCapacity && !hasConflict,
                };
            }),
        );

        return availableStaff.sort((a, b) => a.currentLoad - b.currentLoad);
    }

    /* -------------------- GET STAFF LOAD FOR DATE -------------------- */
    async getStaffLoadForDate(staffId: string, date: Date): Promise<number> {
        const [result] = await this.db.query`
            SELECT COUNT(*)::int as count
            FROM appointments
            WHERE staff_id = ${staffId} AND appointment_date = ${date.toISOString().split('T')[0]}
                  AND status IN ('SCHEDULED', 'COMPLETED')
        `;

        return result.count;
    }

    /* -------------------- CHECK TIME CONFLICT -------------------- */
    async checkTimeConflict(
        staffId: string,
        date: Date,
        time: string,
        duration: number,
    ): Promise<boolean> {
        const appointments = await this.db.query`
            SELECT appointment_time as "appointmentTime", duration
            FROM appointments
            WHERE staff_id = ${staffId} 
                  AND appointment_date = ${date.toISOString().split('T')[0]}
                  AND status IN ('SCHEDULED', 'COMPLETED')
        `;

        const newStart = this.timeToMinutes(time);
        const newEnd = newStart + duration;

        for (const appt of appointments) {
            const existingStart = this.timeToMinutes(appt.appointmentTime);
            const existingEnd = existingStart + appt.duration;

            // Check overlap
            if (
                (newStart >= existingStart && newStart < existingEnd) ||
                (newEnd > existingStart && newEnd <= existingEnd) ||
                (newStart <= existingStart && newEnd >= existingEnd)
            ) {
                return true;
            }
        }

        return false;
    }

    /* -------------------- HELPER: TIME TO MINUTES -------------------- */
    private timeToMinutes(time: string): number {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    }
}