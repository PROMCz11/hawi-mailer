import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { HakimAdminGuard } from '../auth/user/hakim-admin.guard';
import { IngestionService } from './ingestion.service';

/**
 * Admin-only course preparation endpoints. The /control/hakim-courses page
 * drives these directly with a super/ambassador "Hakim admin" token; each
 * processLecture call runs the full chunk+embed pipeline for one lecture.
 */
@Controller('hakim/ingestion')
@UseGuards(HakimAdminGuard)
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Get('courses')
  listCourses() {
    return this.ingestion.listCourses();
  }

  @Get('courses/:courseID/lectures')
  lectures(@Param('courseID', ParseIntPipe) courseID: number) {
    return this.ingestion.lecturesForCourse(courseID);
  }

  @Post('lecture')
  processLecture(@Body() body: { lectureID: number }) {
    return this.ingestion.processLecture(body.lectureID);
  }

  @Post('lecture/clear')
  clearLecture(@Body() body: { lectureID: number }) {
    return this.ingestion.clearLecture(body.lectureID);
  }
}
