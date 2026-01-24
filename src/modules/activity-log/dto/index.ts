import { ActivityType } from '@prisma/client';

export class ActivityLogResponseDto {
  id: string;
  actionType: ActivityType;
  description: string;
  appointment?: {
    id: string;
    customerName: string;
  };
  staff?: {
    id: string;
    name: string;
  };
  timestamp: Date;
  timeAgo: string;
}

export class ActivityLogFilterDto {
  limit?: number;
  actionType?: ActivityType;
  startDate?: Date;
  endDate?: Date;
}