import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthResponseDto, LoginDto, RefreshResponseDto, SignupDto } from './dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) { }

  /* -------------------- SIGNUP -------------------- */
  @Post('signup')
  @ApiOperation({ summary: 'Register a new user' })
  async signup(
    @Body() dto: SignupDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const { accessToken, refreshToken, user } = await this.authService.signup(dto);

    // Set refresh token in httpOnly cookie (not in response body)

    if (refreshToken) {
      this.setRefreshTokenCookie(response, refreshToken);
    }



    return { accessToken, user };
  }

  /* -------------------- LOGIN -------------------- */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const { accessToken, refreshToken, user } = await this.authService.login(dto);

    // Set refresh token in httpOnly cookie
    if (refreshToken) {
      this.setRefreshTokenCookie(response, refreshToken);
    }

    return { accessToken, user };
  }

  /* -------------------- DEMO LOGIN -------------------- */
  @Post('demo-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demo user login (for testing)' })
  async demoLogin(
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const demoEmail = this.configService.get<string>('DEMO_EMAIL');
    const demoPassword = this.configService.get<string>('DEMO_PASSWORD');

    if (!demoEmail || !demoPassword) {
      throw new Error('Demo credentials not configured');
    }

    const { accessToken, refreshToken, user } = await this.authService.login({
      email: demoEmail,
      password: demoPassword,
    });

    if (refreshToken) {
      this.setRefreshTokenCookie(response, refreshToken);
    }

    return { accessToken, user };
  }

  /* -------------------- REFRESH ACCESS TOKEN -------------------- */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRefreshGuard)
  @ApiOperation({ summary: 'Refresh access token using refresh token from cookie' })
  async refreshToken(
    @CurrentUser('userId') userId: string,
    @CurrentUser('refreshToken') refreshToken: string,
  ): Promise<RefreshResponseDto> {
    return await this.authService.refreshAccessToken(userId, refreshToken);
  }

  /* -------------------- LOGOUT -------------------- */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke refresh token' })
  async logout(
    @CurrentUser('id') userId: string,
    @CurrentUser('refreshToken') refreshToken: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string }> {
    await this.authService.logout(userId, refreshToken);

    // Clear refresh token cookie
    response.clearCookie('refreshToken');

    return { message: 'Logged out successfully' };
  }

  /* -------------------- GET PROFILE -------------------- */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getProfile(@CurrentUser() user: any) {
    return user;
  }

  /* -------------------- COOKIE HELPER -------------------- */
  private setRefreshTokenCookie(response: Response, refreshToken: string): void {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const domain = this.configService.get<string>('COOKIE_DOMAIN');
    const secure = this.configService.get('COOKIE_SECURE') === 'true' || isProduction;
    const sameSite = this.configService.get<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE') || 'lax';

    response.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure,
      sameSite,
      domain,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });
  }
}
