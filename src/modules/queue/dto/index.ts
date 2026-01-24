import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// Assign From Queue DTO
export const AssignFromQueueSchema = z.object({
  queueEntryId: z.string().uuid('Invalid queue entry ID'),
  staffId: z.string().uuid('Invalid staff ID'),
});

export class AssignFromQueueDto extends createZodDto(AssignFromQueueSchema) {}

// Queue Entry Response
export class QueueEntryResponseDto {
  id: string;
  queuePosition: number;
  appointment: {
    id: string;
    customerName: string;
    service: {
      id: string;
      name: string;
      duration: number;
      requiredStaffType: string;
    };
    appointmentDate: Date;
    appointmentTime: string;
  };
  addedAt: Date;
  waitingTime: string;
}

// Auto-assign Result
export class AutoAssignResultDto {
  assigned: number;
  failed: number;
  results: Array<{
    appointmentId: string;
    customerName: string;
    success: boolean;
    staffAssigned?: string;
    reason?: string;
  }>;
}