import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/jwt/public.decorator';
import { ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('ping')
@Controller()
export class AppController {
    constructor(private readonly appService: AppService) {}

    @Public()
    @Get('ping')
    ping(): string {
        return this.appService.getHealth();
    }

    @Public()
    @Get('health')
    getHealth(): string {
        return this.appService.getHealth();
    }
}
