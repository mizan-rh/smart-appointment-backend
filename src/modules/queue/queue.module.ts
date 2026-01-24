import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module';
import { StaffModule } from '../staff/staff.module';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';

@Module({
    imports: [StaffModule, ServicesModule],
    controllers: [QueueController],
    providers: [QueueService],
    exports: [QueueService],
})
export class QueueModule { }