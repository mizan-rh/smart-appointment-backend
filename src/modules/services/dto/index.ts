import { ServiceDuration } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Duration helper
export const DURATION_MAP = {
    FIFTEEN_MINUTES: 15,
    THIRTY_MINUTES: 30,
    SIXTY_MINUTES: 60,
};

// Create Service DTO
export const CreateServiceSchema = z.object({
    name: z.string().min(1, 'Service name is required'),
    duration: z.nativeEnum(ServiceDuration),
    requiredStaffType: z.string().min(1, 'Required staff type is required'),
});

export class CreateServiceDto extends createZodDto(CreateServiceSchema) { }

// Update Service DTO
export const UpdateServiceSchema = z.object({
    name: z.string().min(1).optional(),
    duration: z.nativeEnum(ServiceDuration).optional(),
    requiredStaffType: z.string().min(1).optional(),
});

export class UpdateServiceDto extends createZodDto(UpdateServiceSchema) { }

// Service Response DTO
export class ServiceResponseDto {
    id: string;
    name: string;
    duration: ServiceDuration;
    durationMinutes: number;
    requiredStaffType: string;
    createdAt: Date;
}