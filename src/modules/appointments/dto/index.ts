import { AppointmentStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Create Appointment DTO
export const CreateAppointmentSchema = z.object({
  customerName: z.string().min(1, 'Customer name is required'),
  serviceId: z.string().uuid('Invalid service ID'),
  staffId: z.string().uuid('Invalid staff ID').optional(),
  appointmentDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date' })
    .transform((val) => new Date(val)),
  appointmentTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Time must be in HH:MM format'),
});

export class CreateAppointmentDto extends createZodDto(CreateAppointmentSchema) { }

// Update Appointment DTO
export const UpdateAppointmentSchema = z.object({
  customerName: z.string().min(1).optional(),
  serviceId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  appointmentDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date' })
    .transform((val) => new Date(val))
    .optional(),
  appointmentTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
});

export class UpdateAppointmentDto extends createZodDto(UpdateAppointmentSchema) { }

// Appointment Response
export class AppointmentResponseDto {
  id: string;
  customerName: string;
  service: {
    id: string;
    name: string;
    duration: number;
  };
  staff?: {
    id: string;
    name: string;
    serviceType: string;
  };
  appointmentDate: Date;
  appointmentTime: string;
  duration: number;
  status: AppointmentStatus;
  inQueue: boolean;
  queuePosition?: number;
  createdAt: Date;
}

// Conflict Check Response
export class ConflictCheckDto {
  hasConflict: boolean;
  conflictingAppointment?: {
    id: string;
    time: string;
    customerName: string;
  };
  capacityWarning?: string;
  availableStaff?: Array<{
    id: string;
    name: string;
    currentLoad: number;
    capacity: number;
  }>;
}