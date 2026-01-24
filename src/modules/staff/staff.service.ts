import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateStaffDto, UpdateStaffDto } from './dto';

@Injectable()
export class StaffService {
    private readonly logger = new Logger(StaffService.name);

    constructor(private prisma: PrismaService) { }

    /* -------------------- CREATE STAFF -------------------- */
    async create(userId: string, dto: CreateStaffDto) {
        const staff = await this.prisma.staff.create({
            data: {
                userId,
                name: dto.name,
                serviceType: dto.serviceType,
                dailyCapacity: dto.dailyCapacity || 5,
                status: dto.status,
            },
        });

        // Log activity
        await this.prisma.activityLog.create({
            data: {
                userId,
                actionType: 'STAFF_CREATED',
                description: `Staff member "${staff.name}" created`,
                staffId: staff.id,
            },
        });

        this.logger.log(`Staff created: ${staff.name} (${staff.serviceType})`);

        return staff;
    }

    /* -------------------- GET ALL STAFF -------------------- */
    async findAll(userId: string, date?: Date) {
        const staff = await this.prisma.staff.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
        });

        // If date provided, calculate current load
        if (date) {
            const staffWithLoad = await Promise.all(
                staff.map(async (s) => {
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
        const staff = await this.prisma.staff.findFirst({
            where: { id: staffId, userId },
        });

        if (!staff) {
            throw new NotFoundException('Staff member not found');
        }

        return staff;
    }

    /* -------------------- UPDATE STAFF -------------------- */
    async update(userId: string, staffId: string, dto: UpdateStaffDto) {
        await this.findOne(userId, staffId);

        const updated = await this.prisma.staff.update({
            where: { id: staffId },
            data: dto,
        });

        // Log activity
        await this.prisma.activityLog.create({
            data: {
                userId,
                actionType: 'STAFF_UPDATED',
                description: `Staff member "${updated.name}" updated`,
                staffId: updated.id,
            },
        });

        this.logger.log(`Staff updated: ${updated.name}`);

        return updated;
    }

    /* -------------------- DELETE STAFF -------------------- */
    async remove(userId: string, staffId: string) {
        const staff = await this.findOne(userId, staffId);

        // Check if staff has upcoming appointments
        const upcomingAppointments = await this.prisma.appointment.count({
            where: {
                staffId,
                appointmentDate: { gte: new Date() },
                status: 'SCHEDULED',
            },
        });

        if (upcomingAppointments > 0) {
            throw new BadRequestException(
                `Cannot delete staff with ${upcomingAppointments} upcoming appointments`,
            );
        }

        await this.prisma.staff.delete({
            where: { id: staffId },
        });

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
        const staff = await this.prisma.staff.findMany({
            where: {
                userId,
                serviceType,
                status: 'AVAILABLE',
            },
        });

        const availableStaff = await Promise.all(
            staff.map(async (s) => {
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
        const count = await this.prisma.appointment.count({
            where: {
                staffId,
                appointmentDate: date,
                status: { in: ['SCHEDULED', 'COMPLETED'] },
            },
        });

        return count;
    }

    /* -------------------- CHECK TIME CONFLICT -------------------- */
    async checkTimeConflict(
        staffId: string,
        date: Date,
        time: string,
        duration: number,
    ): Promise<boolean> {
        const appointments = await this.prisma.appointment.findMany({
            where: {
                staffId,
                appointmentDate: date,
                status: { in: ['SCHEDULED', 'COMPLETED'] },
            },
            select: {
                appointmentTime: true,
                duration: true,
            },
        });

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