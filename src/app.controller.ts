import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('ping')
@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Get('ping')
    ping(): string {
        return this.appService.getHealth();
    }

    @Get('health')
    getHealth(): string {
        return this.appService.getHealth();
    }
}
