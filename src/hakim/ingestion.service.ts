import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { OpenAiService } from './openai.service';
import { CHUNKING_SYSTEM_PROMPT } from './chunking.prompt';

export interface CourseStatus {
  courseID: number;
  name: string;
  university: string;
  year: number;
  semester: number;
  total_lectures: number;
  chunked_lectures: number;
  chunk_count: number;
}

export interface LectureStatus {
  lectureID: number;
  name: string | null;
  number: number | null;
  professor: string | null;
  has_content: boolean;
  chunk_count: number;
}

const INSERT_BATCH_SIZE = 50;

/**
 * Prepares courses for Hakim by running the lecture → chunk → embed → store
 * pipeline (the same one the manual SvelteKit scripts ran, moved here so it
 * isn't bound by Cloudflare's execution limits). Processing is per-lecture and
 * idempotent: existing chunks for a lecture are replaced, so re-running is safe.
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly openai: OpenAiService,
  ) {}

  async listCourses(): Promise<{ courses: CourseStatus[] }> {
    const courses = await this.supabase.rpc<CourseStatus[]>(
      'get_hakim_course_status',
      {},
    );
    return { courses: courses ?? [] };
  }

  async lecturesForCourse(
    courseID: number,
  ): Promise<{ lectures: LectureStatus[] }> {
    const lectures = await this.supabase.rpc<LectureStatus[]>(
      'get_hakim_lecture_status',
      { p_course_id: courseID },
    );
    return { lectures: lectures ?? [] };
  }

  /** Chunk + embed a single lecture and replace its chunks. */
  async processLecture(lectureID: number): Promise<{
    lectureID: number;
    chunkCount: number;
  }> {
    const lecture = await this.supabase.selectOne<{ content: string | null }>(
      'hawi_lecture',
      `lectureID=eq.${lectureID}&select=content`,
    );

    if (!lecture) {
      throw new BadRequestException('Lecture not found');
    }
    if (!lecture.content || lecture.content.trim().length === 0) {
      throw new BadRequestException('Lecture has no content to chunk');
    }

    const chunks = await this.openai.chunkLecture(
      lecture.content,
      CHUNKING_SYSTEM_PROMPT,
    );

    if (chunks.length === 0) {
      throw new BadRequestException('Chunking produced no chunks');
    }

    const vectors = await this.openai.embedBatch(chunks);
    if (vectors.length !== chunks.length) {
      throw new Error('Embedding count does not match chunk count');
    }

    const rows = chunks.map((content, i) => ({
      lectureID,
      content,
      embedding: vectors[i],
    }));

    // Replace existing chunks so re-processing never duplicates.
    await this.supabase.delete(
      'hawi_lecture_chunk',
      `lectureID=eq.${lectureID}`,
    );

    for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
      await this.supabase.insertMany(
        'hawi_lecture_chunk',
        rows.slice(i, i + INSERT_BATCH_SIZE),
      );
    }

    this.logger.log(`Lecture ${lectureID}: stored ${rows.length} chunks`);
    return { lectureID, chunkCount: rows.length };
  }

  /** Remove all Hakim chunks for a lecture (un-support it). */
  async clearLecture(lectureID: number): Promise<{ lectureID: number }> {
    await this.supabase.delete(
      'hawi_lecture_chunk',
      `lectureID=eq.${lectureID}`,
    );
    return { lectureID };
  }
}
