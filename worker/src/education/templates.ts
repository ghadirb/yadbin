import { DEFAULT_SKILLS, GRADES } from './catalog';

/** Built-in activity templates (v1.2 step 2). They map onto the three existing games, so every template is playable today and
 *  none depends on AI. Each one only supplies DEFAULTS; the teacher can change anything before creating the activity. */
export interface Template {
  id: string; title: string; description: string; category: 'memory' | 'attention' | 'problem_solving';
  gameType: 'memory' | 'attention' | 'problem_solving'; difficultyMode: 'adaptive' | 'easy' | 'medium' | 'hard';
  questionCount: number; suggestedMinutes: number; level: 'introductory' | 'basic' | 'intermediate' | 'advanced';
  skills: string[]; gradeMin: string; gradeMax: string; ageMin: number; ageMax: number;
}
const T = (t: Template): Template => t;
export const TEMPLATES: Template[] = [
  // ---- حافظه
  T({ id: 'memory-visual-intro', title: 'حافظه تصویری مقدماتی', category: 'memory', gameType: 'memory', difficultyMode: 'easy', questionCount: 5, suggestedMinutes: 5, level: 'introductory', skills: ['memory'], gradeMin: 'preschool', gradeMax: 'g2', ageMin: 5, ageMax: 8,
    description: 'چند شکل رنگی یکی‌یکی نشان داده می‌شود؛ دانش‌آموز همان‌ها را به همان ترتیب انتخاب می‌کند. تعداد شکل‌ها کم و زمان نمایش بلند است.' }),
  T({ id: 'memory-visual-mid', title: 'حافظه تصویری متوسط', category: 'memory', gameType: 'memory', difficultyMode: 'medium', questionCount: 8, suggestedMinutes: 8, level: 'intermediate', skills: ['memory', 'visual_accuracy'], gradeMin: 'g3', gradeMax: 'g6', ageMin: 8, ageMax: 12,
    description: 'دنباله‌های ۵ تا ۶ شکلی با زمان نمایش متوسط؛ مناسب تمرین حافظه تصویری کوتاه‌مدت.' }),
  T({ id: 'memory-sequential', title: 'حافظه ترتیبی', category: 'memory', gameType: 'memory', difficultyMode: 'hard', questionCount: 10, suggestedMinutes: 10, level: 'advanced', skills: ['memory', 'focus'], gradeMin: 'g4', gradeMax: 'g9', ageMin: 9, ageMax: 15,
    description: 'دنباله‌های بلندتر و کوتاه‌تر شدن زمان نمایش؛ در برخی سؤال‌ها دنباله باید برعکس بازگو شود.' }),
  // ---- توجه
  T({ id: 'attention-find-target', title: 'پیدا کردن هدف', category: 'attention', gameType: 'attention', difficultyMode: 'easy', questionCount: 6, suggestedMinutes: 6, level: 'introductory', skills: ['attention', 'visual_accuracy'], gradeMin: 'preschool', gradeMax: 'g3', ageMin: 5, ageMax: 9,
    description: 'در یک جدول کوچک، همه‌ی خانه‌های هم‌رنگِ هدف پیدا می‌شوند. گزینه‌ها کم و تفاوت‌ها واضح است.' }),
  T({ id: 'attention-discriminate', title: 'تشخیص تفاوت', category: 'attention', gameType: 'attention', difficultyMode: 'medium', questionCount: 8, suggestedMinutes: 7, level: 'basic', skills: ['visual_accuracy', 'attention'], gradeMin: 'g2', gradeMax: 'g6', ageMin: 7, ageMax: 12,
    description: 'جدول بزرگ‌تر با هدف‌های بیشتر و زمان پاسخ کوتاه‌تر؛ تمرین دقت دیداری.' }),
  T({ id: 'attention-selective', title: 'توجه انتخابی', category: 'attention', gameType: 'attention', difficultyMode: 'hard', questionCount: 10, suggestedMinutes: 10, level: 'advanced', skills: ['attention', 'response_control', 'decision_making'], gradeMin: 'g4', gradeMax: 'g9', ageMin: 9, ageMax: 15,
    description: 'یک رنگ باید انتخاب شود و رنگ دیگر نباید؛ در میانه‌ی فعالیت قاعده عوض می‌شود (کنترل پاسخ و انعطاف توجه).' }),
  // ---- حل مسئله
  T({ id: 'problem-pathfinding', title: 'مسیریابی و منطق تصویری', category: 'problem_solving', gameType: 'problem_solving', difficultyMode: 'easy', questionCount: 6, suggestedMinutes: 8, level: 'introductory', skills: ['problem_solving', 'pattern_recognition'], gradeMin: 'preschool', gradeMax: 'g3', ageMin: 5, ageMax: 9,
    description: 'مسئله‌های تصویری کوتاه با قوانین ساده (کدام فرق دارد؟ بعدی چیست؟) و تلنگر کمکی برای هر سؤال.' }),
  T({ id: 'problem-patterns', title: 'الگوها', category: 'problem_solving', gameType: 'problem_solving', difficultyMode: 'medium', questionCount: 8, suggestedMinutes: 10, level: 'basic', skills: ['pattern_recognition', 'problem_solving'], gradeMin: 'g2', gradeMax: 'g6', ageMin: 7, ageMax: 12,
    description: 'الگوهای تصویری و عددی با طول متوسط؛ دانش‌آموز قاعده‌ی تکرار را پیدا می‌کند.' }),
  T({ id: 'problem-choose-solution', title: 'انتخاب راه‌حل', category: 'problem_solving', gameType: 'problem_solving', difficultyMode: 'hard', questionCount: 10, suggestedMinutes: 12, level: 'advanced', skills: ['problem_solving', 'decision_making'], gradeMin: 'g3', gradeMax: 'g9', ageMin: 8, ageMax: 15,
    description: 'مسئله‌های چندمرحله‌ای که نیاز به برنامه‌ریزی دارند؛ راه‌حل درست را از میان گزینه‌ها انتخاب می‌کند.' }),
];
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null;
const order = (code: string) => GRADES.find((g) => g.code === code)?.order ?? 0;
export const templateDto = (t: Template) => ({ ...t, defaultSkills: DEFAULT_SKILLS[t.gameType] });

/** Filters: grade (template range contains it), skill, level, game. */
export function filterTemplates(q: { grade?: string | null; skill?: string | null; level?: string | null; gameType?: string | null }) {
  const g = q.grade ? GRADES.find((x) => x.code === q.grade)?.order ?? null : null;
  return TEMPLATES.filter((t) => (g === null || (order(t.gradeMin) <= g && g <= order(t.gradeMax))) && (!q.skill || t.skills.includes(q.skill)) && (!q.level || t.level === q.level) && (!q.gameType || t.gameType === q.gameType));
}
