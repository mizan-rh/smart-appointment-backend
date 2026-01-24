import { StaffStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Create Staff DTO
export const CreateStaffSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    serviceType: z.string().min(1, 'Service type is required'),
    dailyCapacity: z.number().int().min(1).max(20).default(5),
    status: z.nativeEnum(StaffStatus).default(StaffStatus.AVAILABLE),
});

export class CreateStaffDto extends createZodDto(CreateStaffSchema) { }

// Update Staff DTO
export const UpdateStaffSchema = z.object({
    name: z.string().min(1).optional(),
    serviceType: z.string().min(1).optional(),
    dailyCapacity: z.number().int().min(1).max(20).optional(),
    status: z.nativeEnum(StaffStatus).optional(),
});

export class UpdateStaffDto extends createZodDto(UpdateStaffSchema) { }

// Staff Response DTO
export class StaffResponseDto {
    id: string;
    name: string;
    serviceType: string;
    dailyCapacity: number;
    status: StaffStatus;
    currentLoad?: number;
    availableSlots?: number;
    createdAt: Date;
}