import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Ctx, Command, Action, On, Update, InjectBot } from 'nestjs-telegraf';
import { Context, Markup, Telegraf } from 'telegraf';
import { ConfigService } from '@nestjs/config';
import { Mistral } from '@mistralai/mistralai';

interface UserState {
  step?: string;
  flow?: 'INSERT' | 'REPLACE';
  targetAction?: 'START' | 'REPLACE' | 'REPORTS';
  adminToken?: string;
  adminID?: number;
  courses?: any[];
  courseLectures?: any[];
  lectures?: any[];
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

function getPrefix(flow?: 'INSERT' | 'REPLACE'): string {
  return flow === 'REPLACE' ? '🔄 استبدال | ' : '➕ إضافة | ';
}

function getItemsForListType(session: UserState, listType: string): { text: string, callback: string }[] {
  if (!session.courses && listType !== 'LECTURE' && listType !== 'PROF') return [];
  if (listType === 'UNI') {
    const universities = [...new Set(session.courses!.map(c => c.university))];
    return universities.map((u, index) => ({ text: u, callback: `UNI_${index}` }));
  }
  if (listType === 'YEAR') {
    const years = [...new Set(session.courses!.filter(c => c.university === session.selectedUniversity).map(c => c.year))].sort();
    return years.map(y => ({ text: String(y), callback: `YEAR_${y}` }));
  }
  if (listType === 'SEMESTER') {
    const semesters = [...new Set(session.courses!.filter(c => c.university === session.selectedUniversity && c.year === session.selectedYear).map(c => c.semester))].sort();
    return semesters.map(s => ({ text: s === 1 ? 'الفصل الأول' : 'الفصل الثاني', callback: `SEMESTER_${s}` }));
  }
  if (listType === 'COURSE') {
    const courses = session.courses!.filter(c =>
      c.university === session.selectedUniversity &&
      c.year === session.selectedYear &&
      c.semester === session.selectedSemester
    );
    return courses.map(c => ({ text: c.name, callback: `COURSE_${c.courseID}` }));
  }
  if (listType === 'PROF') {
    const professors = [...new Set((session.courseLectures || []).map((l: any) => l.professor).filter(Boolean))];
    const items = professors.map((p, index) => ({ text: p, callback: `PROF_${index}` }));
    if (session.flow !== 'REPLACE') {
      items.push({ text: '➕ إضافة دكتور جديد', callback: 'PROF_ADD_NEW' });
    }
    return items;
  }
  if (listType === 'LECTURE') {
    const lectures = session.lectures || [];
    return lectures.map((l: any, index) => ({
      text: `المحاضرة ${l.number}${l.name ? ' - ' + l.name : ''}`,
      callback: `LECTURE_${index}`
    }));
  }
  return [];
}

function buildPaginatedKeyboard(items: { text: string, callback: string }[], page: number, listType: string, step: string, flow?: 'INSERT' | 'REPLACE') {
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

  if (step === 'SELECT_UNI' && flow) {
    const toggleText = flow === 'INSERT' ? '🔄 التبديل إلى وضع الاستبدال' : '➕ التبديل إلى وضع الإضافة';
    rows.push([Markup.button.callback(toggleText, 'TOGGLE_MODE')]);
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
        { command: 'start', description: 'بدء البوت أو إدراج محاضرة جديدة' },
        { command: 'replace', description: 'استبدال محتوى محاضرة موجودة' },
        { command: 'reports', description: 'تفعيل إشعارات الإبلاغات' },
        { command: 'reports_stop', description: 'إيقاف إشعارات الإبلاغات' }
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
    session.flow = 'INSERT';
    session.targetAction = 'START';

    if (session.adminToken && session.adminID) {
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
          const modeText = '➕ وضع الإضافة';
          await ctx.reply(`مرحباً بعودتك!\n${modeText}\nاختر الجامعة:`, buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI', session.flow));
          return;
        }
      } catch (err) {
        this.logger.warn('Existing token failed, prompting re-authentication.');
      }
    }

    clearSession(session);
    session.flow = 'INSERT';
    session.targetAction = 'START';
    session.step = 'AUTH_USERNAME';
    await ctx.reply('مرحباً! الرجاء إدخال اسم مستخدم المشرف للمصادقة.');
  }

  @Command('replace')
  async replaceCommand(@Ctx() ctx: MyContext) {
    if (!ctx.from) return;
    const session = ctx.session;
    session.flow = 'REPLACE';
    session.targetAction = 'REPLACE';

    if (session.adminToken && session.adminID) {
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
          const modeText = '🔄 وضع الاستبدال';
          await ctx.reply(`مرحباً بعودتك!\n${modeText}\nاختر الجامعة:`, buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI', session.flow));
          return;
        }
      } catch (err) {
        this.logger.warn('Existing token failed, prompting re-authentication.');
      }
    }

    clearSession(session);
    session.flow = 'REPLACE';
    session.targetAction = 'REPLACE';
    session.step = 'AUTH_USERNAME';
    await ctx.reply('مرحباً! الرجاء إدخال اسم مستخدم المشرف للمصادقة.');
  }

  @Command('reports')
  async reportsCommand(@Ctx() ctx: MyContext) {
    if (!ctx.from || !ctx.chat) return;
    const session = ctx.session;
    if (!session.adminToken || !session.adminID) {
      session.targetAction = 'REPORTS';
      session.step = 'AUTH_USERNAME';
      await ctx.reply('مرحباً! لإدارة إشعارات الإبلاغات، الرجاء إدخال اسم مستخدم المشرف للمصادقة.');
      return;
    }
    await this.optInToReports(ctx, session);
  }

  @Command('reports_stop')
  async reportsStopCommand(@Ctx() ctx: MyContext) {
    if (!ctx.from || !ctx.chat) return;
    const session = ctx.session;
    if (!session.adminToken || !session.adminID) {
      await ctx.reply('الرجاء تسجيل الدخول أولاً باستخدام /start أو /reports.');
      return;
    }
    await this.optOutOfReports(ctx, session);
  }

  private async optInToReports(ctx: MyContext, session: UserState) {
    if (!ctx.chat) return;
    try {
      const res = await fetch(`${this.sveltekitUrl}/api/internal/admin-telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPassword: this.systemPassword,
          action: 'update',
          adminID: session.adminID,
          telegram_chat_id: ctx.chat.id,
          receive_reports: true
        })
      });
      const json = await res.json();
      if (json.status) {
        await ctx.reply('✅ تم تفعيل إشعارات الإبلاغات بنجاح!\nستصلك رسالة على هذا الحساب في كل مرة يتم فيها الإبلاغ عن سؤال أو بطاقة في المواد التي تملك صلاحية الوصول إليها.\nلإيقاف الإشعارات، استخدم الأمر /reports_stop');
      } else {
        await ctx.reply(`❌ فشل تفعيل الإشعارات: ${json.message || 'خطأ غير معروف'}`);
      }
    } catch (err) {
      this.logger.error(err);
      await ctx.reply('حدث خطأ أثناء الاتصال بالخادم.');
    }
  }

  private async optOutOfReports(ctx: MyContext, session: UserState) {
    try {
      const res = await fetch(`${this.sveltekitUrl}/api/internal/admin-telegram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPassword: this.systemPassword,
          action: 'update',
          adminID: session.adminID,
          receive_reports: false
        })
      });
      const json = await res.json();
      if (json.status) {
        await ctx.reply('🔕 تم إيقاف إشعارات الإبلاغات بنجاح.\nلإعادة تفعيلها، استخدم الأمر /reports');
      } else {
        await ctx.reply(`❌ فشل إيقاف الإشعارات: ${json.message || 'خطأ غير معروف'}`);
      }
    } catch (err) {
      this.logger.error(err);
      await ctx.reply('حدث خطأ أثناء الاتصال بالخادم.');
    }
  }

  @Command('cancel')
  async cancelCommand(@Ctx() ctx: MyContext) {
    if (!ctx.from) return;
    const session = ctx.session;
    const token = session.adminToken;
    const adminID = session.adminID;
    const courses = session.courses;
    const flow = session.flow || 'INSERT';

    clearSession(session);
    session.adminToken = token;
    session.adminID = adminID;
    session.courses = courses;
    session.flow = flow;

    if (session.adminToken && session.adminID && session.courses) {
      session.step = 'SELECT_UNI';
      const items = getItemsForListType(session, 'UNI');
      const modeText = flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';
      await ctx.reply(`تم إلغاء العملية. تم إعادة تعيين التقدم.\n${modeText}\nاختر الجامعة:`, buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI', flow));
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
        const authJson = await authRes.json();

        if (!authRes.ok || !authJson.status) {
          await ctx.reply('فشلت المصادقة. الرجاء المحاولة مرة أخرى باستخدام /start أو /replace.');
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
          await ctx.reply('فشل الحصول على رمز المشرف. الرجاء المحاولة مرة أخرى باستخدام /start أو /replace.');
          clearSession(session);
          return;
        }

        session.adminToken = adminToken;
        session.adminID = authJson.data.adminID;

        if (session.targetAction === 'REPORTS') {
          await this.optInToReports(ctx, session);
          session.targetAction = undefined;
          return;
        }

        const coursesRes = await fetch(`${this.sveltekitUrl}/api/admin/courses`, {
          headers: { 'Cookie': `admin_token=${adminToken}` }
        });
        const coursesJson = await coursesRes.json();
        if (!coursesJson.status || !coursesJson.data.courses) {
          await ctx.reply('فشل تحميل المواد. الرجاء المحاولة مرة أخرى باستخدام /start أو /replace.');
          clearSession(session);
          return;
        }

        session.courses = coursesJson.data.courses;
        session.step = 'SELECT_UNI';
        const items = getItemsForListType(session, 'UNI');
        const modeText = session.flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';
        await ctx.reply(`${modeText}\nاختر الجامعة:`, buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI', session.flow));

      } else if (session.step === 'ENTER_NEW_PROFESSOR') {
        session.selectedProfessor = text;
        session.step = session.flow === 'REPLACE' ? 'ENTER_LECTURE_NUMBER' : 'ENTER_LECTURE_NAME';
        const msg = session.flow === 'REPLACE' ? 'أدخل رقم المحاضرة:' : 'أدخل اسم المحاضرة:';
        await ctx.reply(msg, getTextStepKeyboard());
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
      await ctx.reply('حدث خطأ. الرجاء المحاولة مرة أخرى باستخدام /start أو /replace.');
      clearSession(session);
    }
  }

  @Action(/.*/)
  async onAction(@Ctx() ctx: MyContext) {
    if (!ctx.from) return;
    const session = ctx.session;
    if (!session || !session.step) {
      await ctx.answerCbQuery('انتهت صلاحية الجلسة. الرجاء استخدام /start أو /replace.');
      return;
    }
    if (!session.courses && session.step !== 'AUTH_USERNAME' && session.step !== 'AUTH_PASSWORD') {
      await ctx.answerCbQuery('بيانات الجلسة مفقودة. الرجاء استخدام /start أو /replace.');
      return;
    }

    const data = (ctx.callbackQuery as any)?.data as string;
    if (!data) return;

    try {
      if (data === 'PAGE_NOOP') {
        await ctx.answerCbQuery();
        return;
      }

      if (data === 'TOGGLE_MODE') {
        session.flow = session.flow === 'INSERT' ? 'REPLACE' : 'INSERT';
        const items = getItemsForListType(session, 'UNI');
        const modeText = session.flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';
        await ctx.editMessageText(`${modeText}\nاختر الجامعة:`, buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI', session.flow))
          .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
        return;
      }

      if (data === 'NAV_CANCEL') {
        const token = session.adminToken;
        const adminID = session.adminID;
        const courses = session.courses;
        const flow = session.flow || 'INSERT';
        const wasOnFirstStep = session.step === 'SELECT_UNI';

        clearSession(session);
        session.adminToken = token;
        session.adminID = adminID;
        session.courses = courses;
        session.flow = flow;

        if (wasOnFirstStep) {
          delete session.step;
          await ctx.editMessageText('تم إلغاء العملية. يمكنك البدء من جديد باستخدام /start أو /replace.')
            .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
          await ctx.answerCbQuery();
          return;
        }

        session.step = 'SELECT_UNI';
        const items = getItemsForListType(session, 'UNI');
        const modeText = flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';
        await ctx.editMessageText(`تم إلغاء العملية. تم إعادة تعيين التقدم.\n${modeText}\nاختر الجامعة:`, buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI', flow))
          .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
        return;
      }

      if (data === 'NAV_SIGNOUT') {
        const flow = session.flow || 'INSERT';
        clearSession(session);
        session.flow = flow;
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
        const modeText = session.flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';

        if (session.step === 'SELECT_YEAR') {
          session.step = 'SELECT_UNI';
          items = getItemsForListType(session, 'UNI');
          title = `${modeText}\nاختر الجامعة:`;
          listType = 'UNI';
        } else if (session.step === 'SELECT_SEMESTER') {
          session.step = 'SELECT_YEAR';
          items = getItemsForListType(session, 'YEAR');
          title = `${modeText}\nاختر السنة:`;
          listType = 'YEAR';
        } else if (session.step === 'SELECT_COURSE') {
          session.step = 'SELECT_SEMESTER';
          items = getItemsForListType(session, 'SEMESTER');
          title = `${modeText}\nاختر الفصل:`;
          listType = 'SEMESTER';
        } else if (session.step === 'SELECT_PROFESSOR') {
          session.step = 'SELECT_COURSE';
          items = getItemsForListType(session, 'COURSE');
          title = `${modeText}\nاختر المادة:`;
          listType = 'COURSE';
        } else if (session.step === 'SELECT_LECTURE') {
          session.step = 'SELECT_PROFESSOR';
          items = getItemsForListType(session, 'PROF');
          title = `${modeText}\nاختر الدكتور:`;
          listType = 'PROF';
        } else if (session.step === 'ENTER_NEW_PROFESSOR' || session.step === 'ENTER_LECTURE_NAME') {
          session.step = 'SELECT_PROFESSOR';
          items = getItemsForListType(session, 'PROF');
          title = `${modeText}\nاختر الدكتور:`;
          listType = 'PROF';
        } else if (session.step === 'ENTER_LECTURE_NUMBER') {
          if (session.flow === 'REPLACE') {
            session.step = 'SELECT_LECTURE';
            items = getItemsForListType(session, 'LECTURE');
            title = '🔄 وضع الاستبدال\nاختر المحاضرة المراد استبدالها:';
            listType = 'LECTURE';
          } else {
            session.step = 'ENTER_LECTURE_NAME';
            await ctx.editMessageText('أدخل اسم المحاضرة:', getTextStepKeyboard())
              .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
            await ctx.answerCbQuery();
            return;
          }
        } else if (session.step === 'UPLOAD_PDF') {
          session.step = session.flow === 'REPLACE' ? 'SELECT_LECTURE' : 'ENTER_LECTURE_NUMBER';
          if (session.flow === 'REPLACE') {
            items = getItemsForListType(session, 'LECTURE');
            title = '🔄 وضع الاستبدال\nاختر المحاضرة المراد استبدالها:';
            listType = 'LECTURE';
          } else {
            await ctx.editMessageText('أدخل رقم المحاضرة:', getTextStepKeyboard())
              .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
            await ctx.answerCbQuery();
            return;
          }
        }

        if (listType) {
          await ctx.editMessageText(title, buildPaginatedKeyboard(items, 0, listType, session.step, session.flow))
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
        const keyboard = buildPaginatedKeyboard(items, page, listType, session.step || '', session.flow);
        const modeText = session.flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';
        const titles: Record<string, string> = {
          'UNI': `${modeText}\nاختر الجامعة:`,
          'YEAR': `${modeText}\nاختر السنة:`,
          'SEMESTER': `${modeText}\nاختر الفصل:`,
          'COURSE': `${modeText}\nاختر المادة:`,
          'PROF': `${modeText}\nاختر الدكتور:`,
          'LECTURE': '🔄 وضع الاستبدال\nاختر المحاضرة المراد استبدالها:'
        };

        await ctx.editMessageText(titles[listType] || 'اختر خياراً:', keyboard)
          .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
        return;
      }

      if (data.startsWith('UNI_')) {
        const uniIndex = parseInt(data.substring(4), 10);
        const universities = [...new Set(session.courses!.map(c => c.university))];
        session.selectedUniversity = universities[uniIndex];
        session.step = 'SELECT_YEAR';
        const items = getItemsForListType(session, 'YEAR');
        const modeText = session.flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';
        await ctx.editMessageText(`${modeText}\nاختر السنة:`, buildPaginatedKeyboard(items, 0, 'YEAR', 'SELECT_YEAR', session.flow)).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
      } else if (data.startsWith('YEAR_')) {
        session.selectedYear = parseInt(data.substring(5), 10);
        session.step = 'SELECT_SEMESTER';
        const items = getItemsForListType(session, 'SEMESTER');
        const modeText = session.flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';
        await ctx.editMessageText(`${modeText}\nاختر الفصل:`, buildPaginatedKeyboard(items, 0, 'SEMESTER', 'SELECT_SEMESTER', session.flow)).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
      } else if (data.startsWith('SEMESTER_')) {
        session.selectedSemester = parseInt(data.substring(9), 10);
        session.step = 'SELECT_COURSE';
        const items = getItemsForListType(session, 'COURSE');
        const modeText = session.flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';
        await ctx.editMessageText(`${modeText}\nاختر المادة:`, buildPaginatedKeyboard(items, 0, 'COURSE', 'SELECT_COURSE', session.flow)).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
      } else if (data.startsWith('COURSE_')) {
        session.selectedCourseID = parseInt(data.substring(7), 10);
        let courseLectures: any[] = [];
        try {
          const res = await fetch(`${this.sveltekitUrl}/api/admin/courses/${session.selectedCourseID}/lectures`, {
            headers: { 'Cookie': `admin_token=${session.adminToken}`, 'Accept': 'application/json' }
          });
          const json = await res.json();
          if (json.status && json.data?.lectures) {
            courseLectures = json.data.lectures;
          }
        } catch (e) {
          this.logger.error('Failed to fetch course lectures:', e);
        }
        session.courseLectures = courseLectures;
        session.step = 'SELECT_PROFESSOR';
        const items = getItemsForListType(session, 'PROF');

        if (items.length === 0 || (items.length === 1 && items[0].callback === 'PROF_ADD_NEW')) {
          if (session.flow === 'REPLACE') {
            await ctx.editMessageText('❌ لا توجد محاضرات متاحة للاستبدال في هذه المادة.', getTextStepKeyboard())
              .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
            await ctx.answerCbQuery();
            return;
          }
        }

        const modeText = session.flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';
        await ctx.editMessageText(`${modeText}\nاختر الدكتور:`, buildPaginatedKeyboard(items, 0, 'PROF', 'SELECT_PROFESSOR', session.flow)).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        await ctx.answerCbQuery();
      } else if (data.startsWith('PROF_')) {
        if (data === 'PROF_ADD_NEW') {
          session.step = 'ENTER_NEW_PROFESSOR';
          await ctx.editMessageText('الرجاء إدخال اسم الدكتور الجديد:', getTextStepKeyboard()).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
        } else {
          const profIndex = parseInt(data.substring(5), 10);
          const professors = [...new Set((session.courseLectures || []).map((l: any) => l.professor).filter(Boolean))];
          session.selectedProfessor = professors[profIndex];

          if (session.flow === 'REPLACE') {
            session.lectures = (session.courseLectures || []).filter((l: any) =>
              String(l.professor).trim() === String(session.selectedProfessor).trim()
            );

            if (!session.lectures || session.lectures.length === 0) {
              await ctx.editMessageText('❌ لا توجد محاضرات متاحة للاستبدال لهذا الدكتور.', getTextStepKeyboard())
                .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
              await ctx.answerCbQuery();
              return;
            }

            session.step = 'SELECT_LECTURE';
            const items = getItemsForListType(session, 'LECTURE');
            await ctx.editMessageText('🔄 وضع الاستبدال\nاختر المحاضرة المراد استبدالها:', buildPaginatedKeyboard(items, 0, 'LECTURE', 'SELECT_LECTURE', session.flow))
              .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
          } else {
            session.step = 'ENTER_LECTURE_NAME';
            await ctx.editMessageText('أدخل اسم المحاضرة:', getTextStepKeyboard()).catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
          }
        }
        await ctx.answerCbQuery();
      } else if (data.startsWith('LECTURE_')) {
        const lecIndex = parseInt(data.substring(8), 10);
        const lec = session.lectures?.[lecIndex];
        if (lec) {
          session.lectureNumber = lec.number;
          if (lec.name) session.lectureName = lec.name;
        }
        session.step = 'UPLOAD_PDF';
        await ctx.editMessageText('🔄 وضع الاستبدال\nالرجاء رفع ملف PDF الجديد للمحاضرة.', getTextStepKeyboard())
          .catch(e => { if (!e.message.includes('message is not modified')) this.logger.error(e); });
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
                pageMarkdown = pageMarkdown.replaceAll(pattern, `\n${tableContent}\n`);
              }
            }
          }
        }
        text += pageMarkdown + '\n';
      }

      await ctx.reply('اكتملت المعالجة. جاري حفظ المحاضرة في قاعدة البيانات...');

      const endpoint = session.flow === 'REPLACE' ? '/api/replace-lecture' : '/api/insert-lecture';

      const insertRes = await fetch(`${this.sveltekitUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          systemPassword: this.systemPassword,
          adminID: session.adminID,
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
        await ctx.reply(session.flow === 'REPLACE' ? '✅ تم استبدال المحاضرة بنجاح!' : '✅ تم إدراج المحاضرة بنجاح!');
        session.step = 'SELECT_UNI';
        session.lectureName = undefined;
        session.lectureNumber = undefined;
        session.selectedProfessor = undefined;
        session.selectedCourseID = undefined;
        session.selectedSemester = undefined;
        session.selectedYear = undefined;
        session.selectedUniversity = undefined;
        session.courseLectures = undefined;
        session.lectures = undefined;

        const items = getItemsForListType(session, 'UNI');
        const modeText = session.flow === 'REPLACE' ? '🔄 وضع الاستبدال' : '➕ وضع الإضافة';
        await ctx.reply(`${modeText}\nاختر الجامعة:`, buildPaginatedKeyboard(items, 0, 'UNI', 'SELECT_UNI', session.flow));
      } else {
        await ctx.reply(session.flow === 'REPLACE' ? `❌ فشل استبدال المحاضرة: ${insertJson.message || 'خطأ غير معروف'}` : `❌ فشل إدراج المحاضرة: ${insertJson.message || 'خطأ غير معروف'}`);
      }
    } catch (err) {
      this.logger.error(err);
      await ctx.reply('حدث خطأ أثناء المعالجة أو الإدراج. الرجاء المحاولة مرة أخرى باستخدام /start أو /replace.');
      clearSession(session);
    }
  }
}