import { Module } from '@nestjs/common';
import { ServicesModule } from '../services/services.module';
import { StaffModule } from '../staff/staff.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

@Module({
    imports: [StaffModule, ServicesModule],
    controllers: [AppointmentsController],
    providers: [AppointmentsService],
    exports: [AppointmentsService],
})
export class AppointmentsModule { }