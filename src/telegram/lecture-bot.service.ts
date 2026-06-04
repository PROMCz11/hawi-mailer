import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Ctx, Command, Action, On, Update, InjectBot } from 'nestjs-telegraf';
import { Context, Markup, Telegraf } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { Mistral } from '@mistralai/mistralai';

interface UserState {
  step?: string;
  adminToken?: string;
  courses?: any[];
  selectedUniversity?: string;
  selectedYear?: number;
  selectedSemester?: number;
  selectedCourseID?: number;
  selectedProfessor?: string;
  lectureName?: string;
  lectureNumber?: number;
  username?: string;
}

type MyContext = Context & { session: UserState };

const ITEMS_PER_PAGE = 10;

function convertArabicNumeralsToEnglish(text: string): string {
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const persianNumerals = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  let result = text;
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(arabicNumerals[i], 'g'), String(i));
    result = result.replace(new RegExp(persianNumerals[i], 'g'), String(i));
  }
  return result;
}

function getItemsForListType(session: UserState, listType: string): { text: string, callback: string }[] {
  if (!session.courses) return [];
  
  if (listType === 'UNI') {
    const universities = [...new Set(session.courses.map(c => c.university))];
    return universities.map(u => ({ text: u, callback: `UNI_${u}` }));
  }
  if (listType === 'YEAR') {
    const years = [...new Set(session.courses.filter(c => c.university === session.selectedUniversity).map(c => c.year))].sort();
    return years.map(y => ({ text: String(y), callback: `YEAR_${y}` }));
  }
  if (listType === 'SEMESTER') {
    const semesters = [...new Set(session.courses.filter(c => c.university === session.selectedUniversity && c.year === session.selectedYear).map(c => c.semester))].sort();
    return semesters.map(s => ({ text: s === 1 ? 'الفصل الأول' : 'الفصل الثاني', callback: `SEMESTER_${s}` }));
  }
  if (listType === 'COURSE') {
    const courses = session.courses.filter(c => 
      c.university === session.selectedUniversity && 
      c.year === session.selectedYear && 
      c.semester === session.selectedSemester
    );
    return courses.map(c => ({ text: c.name, callback: `COURSE_${c.courseID}` }));
  }
  if (listType === 'PROF') {
    const course = session.courses.find(c => c.courseID === session.selectedCourseID);
    const professors = course?.professors || [];
    const items = professors.map(p => ({ text: p, callback: `PROF_${p}` }));
    items.push({ text: '➕ إضافة دكتور جديد', callback: 'PROF_ADD_NEW' });
    return items;
  }
  return [];
}

function buildPaginatedKeyboard(items: { text: string, callback: string }[], page: number, listType: string, step: string) {
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  
  const start = safePage * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const pageItems = items.slice(start, end);
  
  const rows: any[][] = [];
  for (let i = 0; i < pageItems.length; i += 2) {
    rows.push(pageItems.slice(i, i + 2).map(item => Markup.button.callback(item.text, item.callback)));
  }
  
  if (totalPages > 1) {
    const pageNavRow: any[] = [];
    if (safePage > 0) {
      pageNavRow.push(Markup.button.callback('⬅️', `PAGE_${listType}_${safePage - 1}`));
    }
    pageNavRow.push(Markup.button.callback(`📍 ${safePage + 1}/${totalPages}`, `PAGE_NOOP`));
    if (safePage < totalPages - 1) {
      pageNavRow.push(Markup.button.callback('➡️', `PAGE_${listType}_${safePage + 1}`));
    }
    rows.push(pageNavRow);
  }
  
  const stepNavRow: any[] = [];
  if (step === 'SELECT_UNI') {
    stepNavRow.push(Markup.button.callback('🚪 تسجيل الخروج', 'NAV_SIGNOUT'));
  } else {
    stepNavRow.push(Markup.button.callback('🔙 السابق', 'NAV_BACK'));
  }
  stepNavRow.push(Markup.button.callback('❌ إلغاء', 'NAV_CANCEL'));
  rows.push(stepNavRow);
  
  return Markup.inlineKeyboard(rows);
}

function getTextStepKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔙 السابق', 'NAV_BACK'),
      Markup.button.callback('❌ إلغاء', 'NAV_CANCEL')
    ]
  ]);
}

function clearSession(session: UserState) {
  Object.keys(session).forEach(key => {
    delete session[key as keyof UserState];
  });
}

@Update()
@Injectable()
export class LectureBotService implements OnModuleInit {
  private readonly logger = new Logger(LectureBotService.name);
  private readonly mistral: Mistral;
  private readonly sveltekitUrl: string;
  private readonly systemPassword: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectBot() private readonly bot: Telegraf<Context>
  ) {
    const mistralApiKey = this.configService.get<string>('MISTRAL_API_KEY');
    this.mistral = new Mistral({ apiKey: mistralApiKey });
    this.sveltekitUrl = this.configService.get<string>('SVELTEKIT_URL') || 'http://localhost:5173';
    this.systemPassword = this.configService.get<string>('SYSTEM_PASSWORD') || '';
  }

  async onModuleInit() {
    try {
      await this.bot.telegram.setMyCommands([
        { command: 'start', description: 'بدء البوت أو إدراج محاضرة جديدة' }
      ]);
      this.logger.log('Bot commands menu updated successfully.');
    } catch (err) {
      this.logger.error('Failed to set bot commands menu:', err);
    }
  }

  @Command('start')
  @Command('insert_lecture')
  async startCommand(@Ctx() ctx: MyContext) {
    if (!ctx.from) return;
    const session = ctx.session;
    
    if (session.adminToken) {
      await ctx.reply('جاري التحقق من الجلسة الحالية...');
      try {
        const coursesRes = await fetch(`${this.sveltekitUrl}/api/admin/courses`, {
          headers: { 'Cookie': `admin_token=${session.adminToken}` }
        });
        const coursesJson = await coursesRes.json();
        
        if (coursesJson.status && coursesJson.data.courses) {
          session.courses = coursesJson.data.courses;
          session.step = 'SELECT_UNI';
          const items = getItemsForListType(session, 'UNI');
          await ctx.reply('مرحباً بعودتك! اختر الجامعة:', buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI'));
          return;
        }
      } catch (err) {
        this.logger.warn('Existing token failed, prompting re-authentication.');
      }
    }

    clearSession(session);
    session.step = 'AUTH_USERNAME';
    await ctx.reply('مرحباً! الرجاء إدخال اسم مستخدم المشرف للمصادقة.');
  }

  @Command('cancel')
  async cancelCommand(@Ctx() ctx: MyContext) {
    if (!ctx.from) return;
    const session = ctx.session;
    const token = session.adminToken;
    const courses = session.courses;
    
    clearSession(session);
    session.adminToken = token;
    session.courses = courses;

    if (session.adminToken && session.courses) {
      session.step = 'SELECT_UNI';
      const items = getItemsForListType(session, 'UNI');
      await ctx.reply('تم إلغاء العملية. تم إعادة تعيين التقدم. اختر الجامعة:', buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI'));
    } else {
      await ctx.reply('تم إلغاء العملية.');
    }
  }

  @On('text')
  async onText(@Ctx() ctx: MyContext) {
    if (!ctx.from) return;
    const session = ctx.session;
    if (!session || !session.step) return;

    const text = (ctx.message as any)?.text;
    if (!text) return;

    try {
      if (session.step === 'AUTH_USERNAME') {
        session.username = text;
        session.step = 'AUTH_PASSWORD';
        await ctx.reply('الرجاء إدخال كلمة مرور المشرف.');
      } else if (session.step === 'AUTH_PASSWORD') {
        const password = text;
        await ctx.reply('جاري المصادقة...');
        
        const authRes = await fetch(`${this.sveltekitUrl}/api/admin/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: session.username, password })
        });

        if (!authRes.ok) {
          await ctx.reply('فشلت المصادقة. الرجاء المحاولة مرة أخرى باستخدام /start.');
          clearSession(session);
          return;
        }

        const authJson = await authRes.json();
        if (!authJson.status) {
          await ctx.reply('فشلت المصادقة. الرجاء المحاولة مرة أخرى باستخدام /start.');
          clearSession(session);
          return;
        }

        const setCookies = authRes.headers.getSetCookie ? authRes.headers.getSetCookie() : [authRes.headers.get('set-cookie')];
        let adminToken = '';
        for (const cookie of setCookies) {
          if (cookie && cookie.includes('admin_token=')) {
            const match = cookie.match(/admin_token=([^;]+)/);
            if (match) {
              adminToken = match[1];
              break;
            }
          }
        }

        if (!adminToken) {
          await ctx.reply('فشل الحصول على رمز المشرف. الرجاء المحاولة مرة أخرى باستخدام /start.');
          clearSession(session);
          return;
        }

        session.adminToken = adminToken;

        const coursesRes = await fetch(`${this.sveltekitUrl}/api/admin/courses`, {
          headers: { 'Cookie': `admin_token=${adminToken}` }
        });
        const coursesJson = await coursesRes.json();
        
        if (!coursesJson.status || !coursesJson.data.courses) {
          await ctx.reply('فشل تحميل المواد. الرجاء المحاولة مرة أخرى باستخدام /start.');
          clearSession(session);
          return;
        }

        session.courses = coursesJson.data.courses;
        
        session.step = 'SELECT_UNI';
        const items = getItemsForListType(session, 'UNI');
        await ctx.reply('اختر الجامعة:', buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI'));

      } else if (session.step === 'ENTER_NEW_PROFESSOR') {
        session.selectedProfessor = text;
        session.step = 'ENTER_LECTURE_NAME';
        await ctx.reply('أدخل اسم المحاضرة:', getTextStepKeyboard());
      } else if (session.step === 'ENTER_LECTURE_NAME') {
        session.lectureName = text;
        session.step = 'ENTER_LECTURE_NUMBER';
        await ctx.reply('أدخل رقم المحاضرة:', getTextStepKeyboard());
      } else if (session.step === 'ENTER_LECTURE_NUMBER') {
        const convertedText = convertArabicNumeralsToEnglish(text);
        const num = parseInt(convertedText, 10);
        if (isNaN(num)) {
          await ctx.reply('رقم غير صالح. الرجاء إدخال رقم محاضرة صالح:', getTextStepKeyboard());
          return;
        }
        session.lectureNumber = num;
        session.step = 'UPLOAD_PDF';
        await ctx.reply('الرجاء رفع ملف PDF للمحاضرة.', getTextStepKeyboard());
      }
    } catch (err) {
      this.logger.error(err);
      await ctx.reply('حدث خطأ. الرجاء المحاولة مرة أخرى باستخدام /start.');
      clearSession(session);
    }
  }

  @Action(/.*/)
  async onAction(@Ctx() ctx: MyContext) {
    if (!ctx.from) return;
    const session = ctx.session;
    if (!session || !session.step) {
      await ctx.answerCbQuery('انتهت صلاحية الجلسة. الرجاء استخدام /start.');
      return;
    }

    if (!session.courses && session.step !== 'AUTH_USERNAME' && session.step !== 'AUTH_PASSWORD') {
      await ctx.answerCbQuery('بيانات الجلسة مفقودة. الرجاء استخدام /start.');
      return;
    }

    const data = (ctx.callbackQuery as any)?.data as string;
    if (!data) return;
    
    try {
      if (data === 'PAGE_NOOP') {
        await ctx.answerCbQuery();
        return;
      }

      if (data === 'NAV_CANCEL') {
        const token = session.adminToken;
        const courses = session.courses;
        clearSession(session);
        session.adminToken = token;
        session.courses = courses;
        session.step = 'SELECT_UNI';
        
        const items = getItemsForListType(session, 'UNI');
        await ctx.editMessageText('تم إلغاء العملية. اختر الجامعة:', buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI'))
          .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
        return;
      }

      if (data === 'NAV_SIGNOUT') {
        clearSession(session);
        session.step = 'AUTH_USERNAME';
        await ctx.editMessageText('مرحباً! الرجاء إدخال اسم مستخدم المشرف للمصادقة.')
          .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
        return;
      }

      if (data === 'NAV_BACK') {
        let items: { text: string, callback: string }[] = [];
        let title = '';
        let listType = '';

        if (session.step === 'SELECT_YEAR') {
          session.step = 'SELECT_UNI';
          items = getItemsForListType(session, 'UNI');
          title = 'اختر الجامعة:';
          listType = 'UNI';
        } else if (session.step === 'SELECT_SEMESTER') {
          session.step = 'SELECT_YEAR';
          items = getItemsForListType(session, 'YEAR');
          title = 'اختر السنة:';
          listType = 'YEAR';
        } else if (session.step === 'SELECT_COURSE') {
          session.step = 'SELECT_SEMESTER';
          items = getItemsForListType(session, 'SEMESTER');
          title = 'اختر الفصل:';
          listType = 'SEMESTER';
        } else if (session.step === 'SELECT_PROFESSOR') {
          session.step = 'SELECT_COURSE';
          items = getItemsForListType(session, 'COURSE');
          title = 'اختر المادة:';
          listType = 'COURSE';
        } else if (session.step === 'ENTER_NEW_PROFESSOR' || session.step === 'ENTER_LECTURE_NAME') {
          session.step = 'SELECT_PROFESSOR';
          items = getItemsForListType(session, 'PROF');
          title = 'اختر الدكتور:';
          listType = 'PROF';
        } else if (session.step === 'ENTER_LECTURE_NUMBER') {
          session.step = 'ENTER_LECTURE_NAME';
          await ctx.editMessageText('أدخل اسم المحاضرة:', getTextStepKeyboard())
            .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
          await ctx.answerCbQuery();
          return;
        } else if (session.step === 'UPLOAD_PDF') {
          session.step = 'ENTER_LECTURE_NUMBER';
          await ctx.editMessageText('أدخل رقم المحاضرة:', getTextStepKeyboard())
            .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
          await ctx.answerCbQuery();
          return;
        }

        if (listType) {
          await ctx.editMessageText(title, buildPaginatedKeyboard(items, 0, listType, session.step))
            .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        }
        await ctx.answerCbQuery();
        return;
      }

      if (data.startsWith('PAGE_')) {
        const parts = data.split('_');
        const listType = parts[1];
        const page = parseInt(parts[2], 10);
        const items = getItemsForListType(session, listType);
        const keyboard = buildPaginatedKeyboard(items, page, listType, session.step || '');
        
        const titles: Record<string, string> = {
          'UNI': 'اختر الجامعة:',
          'YEAR': 'اختر السنة:',
          'SEMESTER': 'اختر الفصل:',
          'COURSE': 'اختر المادة:',
          'PROF': 'اختر الدكتور:'
        };
        
        await ctx.editMessageText(titles[listType] || 'اختر خياراً:', keyboard)
          .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
        return;
      }

      if (data.startsWith('UNI_')) {
        session.selectedUniversity = data.substring(4);
        session.step = 'SELECT_YEAR';
        const items = getItemsForListType(session, 'YEAR');
        await ctx.editMessageText('اختر السنة:', buildPaginatedKeyboard(items, 0, 'YEAR', 'SELECT_YEAR')).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
      } else if (data.startsWith('YEAR_')) {
        session.selectedYear = parseInt(data.substring(5), 10);
        session.step = 'SELECT_SEMESTER';
        const items = getItemsForListType(session, 'SEMESTER');
        await ctx.editMessageText('اختر الفصل:', buildPaginatedKeyboard(items, 0, 'SEMESTER', 'SELECT_SEMESTER')).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
      } else if (data.startsWith('SEMESTER_')) {
        session.selectedSemester = parseInt(data.substring(9), 10);
        session.step = 'SELECT_COURSE';
        const items = getItemsForListType(session, 'COURSE');
        await ctx.editMessageText('اختر المادة:', buildPaginatedKeyboard(items, 0, 'COURSE', 'SELECT_COURSE')).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
      } else if (data.startsWith('COURSE_')) {
        session.selectedCourseID = parseInt(data.substring(7), 10);
        session.step = 'SELECT_PROFESSOR';
        const items = getItemsForListType(session, 'PROF');
        await ctx.editMessageText('اختر الدكتور:', buildPaginatedKeyboard(items, 0, 'PROF', 'SELECT_PROFESSOR')).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
      } else if (data.startsWith('PROF_')) {
        if (data === 'PROF_ADD_NEW') {
          session.step = 'ENTER_NEW_PROFESSOR';
          await ctx.editMessageText('الرجاء إدخال اسم الدكتور الجديد:', getTextStepKeyboard()).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        } else {
          session.selectedProfessor = data.substring(5);
          session.step = 'ENTER_LECTURE_NAME';
          await ctx.editMessageText('أدخل اسم المحاضرة:', getTextStepKeyboard()).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        }
        await ctx.answerCbQuery();
      }
    } catch (err) {
      this.logger.error(err);
      await ctx.answerCbQuery('حدث خطأ.');
    }
  }

  @On('document')
  async onDocument(@Ctx() ctx: MyContext) {
    if (!ctx.from) return;
    const session = ctx.session;
    if (!session || session.step !== 'UPLOAD_PDF') return;

    const document = (ctx.message as any)?.document;
    if (!document) return;
    const isPdf = document.mime_type?.includes('pdf') || document.file_name?.toLowerCase().endsWith('.pdf');
    
    if (!isPdf) {
      await ctx.reply('الرجاء رفع ملف PDF صالح.', getTextStepKeyboard());
      return;
    }

    await ctx.reply('جاري معالجة ملف PDF... قد يستغرق هذا دقيقة.');

    try {
      const fileLink = await ctx.telegram.getFileLink(document.file_id);
      const response = await fetch(fileLink.toString());
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const blob = new Blob([buffer], { type: 'application/pdf' });

      const uploaded = await this.mistral.files.upload({ file: blob, purpose: 'ocr' });
      const signed = await this.mistral.files.getSignedUrl({ fileId: uploaded.id });
      
      const result = await this.mistral.ocr.process({
        model: 'mistral-ocr-latest',
        document: { type: 'document_url', documentUrl: signed.url },
        tableFormat: 'markdown',
        extractHeader: true,
        extractFooter: true
      });

      let text = '';
      for (const page of result.pages) {
        let pageMarkdown = page.markdown ?? '';
        
        if ((page as any).tables && Array.isArray((page as any).tables)) {
          for (const table of (page as any).tables) {
            const tableId = table.id;
            const tableContent = table.markdown || table.html || table.content || '';
            
            if (tableId && tableContent) {
              const patterns = [
                `[${tableId}.md](${tableId}.md)`,
                `[${tableId}](${tableId})`,
                `![${tableId}.md](${tableId}.md)`,
                `![${tableId}](${tableId})`,
                `[${tableId}](${tableId}.md)`,
                `![${tableId}](${tableId}.md)`
              ];
              for (const pattern of patterns) {
                pageMarkdown = pageMarkdown.replaceAll(pattern, `\n\n${tableContent}\n\n`);
              }
            }
          }
        }
        text += pageMarkdown + '\n\n';
      }

      await ctx.reply('اكتملت المعالجة. جاري حفظ المحاضرة في قاعدة البيانات...');

      const insertRes = await fetch(`${this.sveltekitUrl}/api/insert-lecture`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemPassword: this.systemPassword,
          lecture: {
            courseID: session.selectedCourseID,
            name: session.lectureName,
            number: session.lectureNumber,
            professor: session.selectedProfessor,
            content: text
          }
        })
      });

      const insertJson = await insertRes.json();
      if (insertJson.status) {
        await ctx.reply('✅ تم إدراج المحاضرة بنجاح!');
        
        session.step = 'SELECT_UNI';
        session.lectureName = undefined;
        session.lectureNumber = undefined;
        session.selectedProfessor = undefined;
        session.selectedCourseID = undefined;
        session.selectedSemester = undefined;
        session.selectedYear = undefined;
        session.selectedUniversity = undefined;
        
        const items = getItemsForListType(session, 'UNI');
        await ctx.reply('اختر الجامعة للمحاضرة التالية:', buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI'));
      } else {
        await ctx.reply(`❌ فشل إدراج المحاضرة: ${insertJson.message || 'خطأ غير معروف'}`);
      }
    } catch (err) {
      this.logger.error(err);
      await ctx.reply('حدث خطأ أثناء المعالجة أو الإدراج. الرجاء المحاولة مرة أخرى باستخدام /start.');
      clearSession(session);
    }
  }
}