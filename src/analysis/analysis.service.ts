import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const SYSTEM_PROMPT = `You are a senior medical professor with expertise across anatomy, physiology,
pharmacology, pathology, microbiology, and internal medicine. You review and
correct multiple-choice questions (MCQs) submitted by students for practice
purposes only — these are never used in any clinical or applied medical context.

## HOW DATA ARRIVES
You will receive data across sequential user messages:
- First message(s): Lecture files — read and internalize them as your reference
  knowledge base
- Subsequent message(s): A JSON array of MCQs to review against those lectures

Begin reviewing only after questions are submitted. Do not prompt the user for
lectures or questions.

---

## INPUT FORMAT
Each question arrives as a JSON object with the following fields:
- "questionID": unique identifier for the question
- "body": the question stem in Arabic
- "answers": array of answer objects, each with:
  - "content": the answer text
  - "correct": boolean indicating the intended answer (true = chosen answer)
- "explanation": the question bank's own explanation (use as supplementary
  context only — your lectures are the authority)

Derive answer letters positionally: first answer object = A, second = B, and
so on.

---

## REVIEW RULES

### CORRECT QUESTIONS → SKIP ENTIRELY
If the answer marked "correct": true matches standard medical teaching from
your lectures, do not include that question in your output at all. Return
nothing for it.

### ODD-ONE-OUT QUESTIONS
Some questions list 3+ correct statements and 1 incorrect one, where the
answer marked "correct": true is the exception/odd-one-out choice.

First, check the question body for an explicit exception indicator — any of:
"ماعدا", "عدا", "إلا", "except", "كل ما يلي... ماعدا", or any equivalent
phrasing that clearly tells the reader to pick the wrong/exception item.

- If the exception indicator IS present in the body → the answer is valid,
  **skip the question entirely** (do not include it in output).
- If the exception indicator is NOT present in the body (i.e., the question
  reads like a normal "which is correct" question but the marked answer is
  actually the odd-one-out) → include it in output with
  "question_type": "odd_one_out". This is a phrasing problem: students will
  not know they are supposed to pick the exception.

### INCORRECT QUESTIONS → OUTPUT STRUCTURED JSON
If the answer marked "correct": true is wrong, output a JSON object for it.

---

## OUTPUT FORMAT
Return a single JSON array containing only flagged questions.
If no questions are incorrect, return an empty array: []

Each object must follow this exact schema:

{
  "questionID": <integer, copied from input>,
  "question_type": "incorrect" | "odd_one_out",
  "issue": "<وصف موجز للمشكلة باللغة العربية>",
  "correct_answer": "<letter only, e.g. B>",
  "reasoning": "<1–3 sentences in Arabic citing the specific lecture name and
                 the piece of information that supports the correct answer>"
}

Output raw JSON only. No markdown, no code fences, no explanation outside the array.

---

## EXAMPLES

### Input:
[
  {
    "questionID": 1001,
    "body": "من مضادات الهيستامين التي تسبب تهدئة ونعاس:",
    "answers": [
      { "content": "Chlorpheniramine", "correct": true },
      { "content": "Ranitidine", "correct": false },
      { "content": "Loratadine", "correct": false },
      { "content": "Betahistine", "correct": false }
    ],
    "explanation": "Chlorpheniramine هو مضاد هيستامين من الجيل الأول..."
  },
  {
    "questionID": 1002,
    "body": "أي من البروستاغلاندينات التالية يمتلك تأثير مقبض للقصبات:",
    "answers": [
      { "content": "PGE", "correct": false },
      { "content": "PGF (الفا٢)", "correct": false },
      { "content": "PGI2", "correct": false },
      { "content": "PGA", "correct": true }
    ],
    "explanation": "..."
  },
  {
    "questionID": 1003,
    "body": "الطعوم الجلدية كاملة السماكة:",
    "answers": [
      { "content": "تتوافر منها كميات أقل بالمقارنة مع الطعوم جزئية السماكة", "correct": false },
      { "content": "أقل جودة من الناحية التجميلية بالمقارنة مع الطعوم جزئية السماكة", "correct": true },
      { "content": "جيدة المقاومة من الناحية الميكانيكية مقارنة مع الطعوم جزئية السماكة", "correct": false },
      { "content": "لا يحتاج الحصول عليها لاستخدام قاطع الجلد (الديرماتوم)", "correct": false }
    ],
    "explanation": "..."
  }
]

### Output:
[
  {
    "questionID": 1002,
    "question_type": "incorrect",
    "issue": "الإجابة المحددة D (PGA) خاطئة؛ البروستاغلاندين الذي يسبب تقبضاً قصبياً هو PGF2α وهو الخيار B",
    "correct_answer": "B",
    "reasoning": "في محاضرة الأدوية ذات العلاقة بعناصر الاكتفاء الذاتي، قسم البروستاغلاندينات، ورد أن PGF2α يسبب تقبض قصبي، بينما PGE وPGI2 يسببان توسعاً قصبياً. PGA لم يُذكر له تأثير مقبض."
  },
  {
    "questionID": 1003,
    "question_type": "odd_one_out",
    "issue": "الخيارات A وC وD عبارات صحيحة عن الطعوم كاملة السماكة؛ الخيار B هو العبارة الخاطئة وهو الإجابة المقصودة — تم تصنيف السؤال كنوع استثناء",
    "correct_answer": "B",
    "reasoning": "الطعوم الجلدية كاملة السماكة أفضل من الناحية التجميلية وليست أقل جودة، لذا فإن الخيار B هو البيان الخاطئ الوحيد بين الخيارات، وهو ما تستهدفه السؤال."
  }
]`;

function extractJson(raw: string): string {
  // Strip markdown code fences
  let s = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Find the outermost JSON array
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start !== -1 && end !== -1 && end > start) {
    s = s.slice(start, end + 1);
  }
  // Fix stray spaces inside JSON keys: " "key" -> "key"
  s = s.replace(/"(\s+)"/g, '"');
  return s;
}

interface Question {
  questionID: number;
  body: string;
  answers: { content: string; correct: boolean }[];
  explanation?: string;
}

interface Lecture {
  name: string;
  content: string;
}

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly apiKey: string;
  private readonly supabaseUrl: string;
  private readonly supabaseKey: string;

  constructor(private configService: ConfigService) {
    this.apiKey = configService.getOrThrow<string>('DEEPSEEK_API_KEY');
    this.supabaseUrl = configService.getOrThrow<string>('SUPABASE_URL');
    this.supabaseKey = configService.getOrThrow<string>('SUPABASE_SERVICE_KEY');
  }

  async analyzeBatch(questions: Question[], lectures: Lecture[]): Promise<void> {
    try {
      if (questions.length === 0) return;

      const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }];

      for (const lecture of lectures) {
        if (lecture.content) {
          messages.push({
            role: 'user',
            content: `[محاضرة: ${lecture.name}]\n\n${lecture.content}`,
          });
        }
      }

      messages.push({
        role: 'assistant',
        content: 'تم استلام المحاضرات. أنا جاهز لمراجعة الأسئلة.',
      });

      const questionsPayload = questions.map((q) => ({
        questionID: q.questionID,
        body: q.body,
        answers: q.answers,
        explanation: q.explanation,
      }));

      messages.push({ role: 'user', content: JSON.stringify(questionsPayload) });

      const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: 'deepseek-v4-pro', messages, temperature: 0.1, max_tokens: 8192 }),
      });

      if (!aiRes.ok) {
        this.logger.error(`Deepseek API error: ${aiRes.status}`);
        return;
      }

      const aiData = await aiRes.json() as any;
      const raw: string = aiData?.choices?.[0]?.message?.content?.trim() ?? '[]';

      let flagged: any[];
      try {
        flagged = JSON.parse(extractJson(raw));
      } catch {
        this.logger.error('Failed to parse AI response', raw.slice(0, 500));
        return;
      }

      if (!Array.isArray(flagged) || flagged.length === 0) {
        this.logger.log('Analysis complete: no flags');
        return;
      }

      for (const flag of flagged) {
        if (
          !flag.questionID ||
          !flag.question_type ||
          !flag.issue ||
          !flag.correct_answer ||
          !flag.reasoning
        ) continue;

        await fetch(`${this.supabaseUrl}/rest/v1/hawi_question_flag`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: this.supabaseKey,
            Authorization: `Bearer ${this.supabaseKey}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            questionID: flag.questionID,
            question_type: flag.question_type,
            issue: flag.issue,
            correct_answer: flag.correct_answer,
            reasoning: flag.reasoning,
          }),
        });
      }

      this.logger.log(`Analysis complete: ${flagged.length} flag(s) inserted`);
    } catch (err: any) {
      this.logger.error('Analysis failed', err?.message);
    }
  }
}
