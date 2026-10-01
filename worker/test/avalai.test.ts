import { describe, expect, it, vi } from 'vitest';
import { avalaiText, extractJson, mergeModelDraft, ruleDrafts } from '../src/ai/builder';

const env = (o: any = {}) => ({ AVALAI_API_KEY: 'sk-test-key', ...o }) as any;
const reply = (content: string, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { 'avalai-request-id': 'req-1' } });

describe('AvalAI provider (v1.2 AI builder)', () => {
  it('returns null without a key and never calls the network', async () => {
    const f = vi.fn();
    expect(await avalaiText({} as any, 'x', f as any)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it('calls /chat/completions with bearer auth, pinned model and only system+facts', async () => {
    const f = vi.fn(async () => reply('{"title":"سلام"}'));
    const out = await avalaiText(env({ AVALAI_MODEL: 'gpt-x' }), 'FACTS', f as any);
    expect(out).toBe('{"title":"سلام"}');
    const [url, init] = f.mock.calls[0] as any;
    expect(url).toBe('https://api.avalai.ir/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-x');
    expect(body.messages.map((m: any) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[1].content).toBe('FACTS');
  });

  it('honours AVALAI_BASE_URL and trims trailing slashes', async () => {
    const f = vi.fn(async () => reply('{}'));
    await avalaiText(env({ AVALAI_BASE_URL: 'https://proxy.example/v1//' }), 'x', f as any);
    expect((f.mock.calls[0] as any)[0]).toBe('https://proxy.example/v1/chat/completions');
  });

  it.each([429, 401, 500])('falls back (null) on HTTP %i', async (status) => {
    expect(await avalaiText(env(), 'x', (async () => reply('{}', status)) as any)).toBeNull();
  });

  it('falls back on network error and malformed body', async () => {
    expect(await avalaiText(env(), 'x', (async () => { throw new Error('down'); }) as any)).toBeNull();
    expect(await avalaiText(env(), 'x', (async () => new Response('not json')) as any)).toBeNull();
    expect(await avalaiText(env(), 'x', (async () => new Response(JSON.stringify({ choices: [] }))) as any)).toBeNull();
  });

  it('extractJson tolerates fences/prose and rejects garbage', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('بله: {"a":2} تمام')).toEqual({ a: 2 });
    expect(extractJson('no json')).toBeNull();
    expect(extractJson('{broken')).toBeNull();
  });

  it('model output is re-validated: invalid fields are replaced by the rule-based value', () => {
    const base = ruleDrafts('یک فعالیت برای تقویت حافظه پایه دوم', { gradeOrder: 2, age: 7, skillNotes: [] })[0];
    const merged = mergeModelDraft(base, { gameType: 'hacking', level: 'god', questionCount: 999, skills: ['memory', 'nope'], ageMin: 1, ageMax: 99, title: '<script>x</script> فعالیت' });
    expect(merged.gameType).toBe(base.gameType);
    expect(merged.level).toBe(base.level);
    expect(merged.questionCount).toBe(12);
    expect(merged.skills).toEqual(['memory']);
    expect(merged.ageMin).toBe(base.ageMin);
    expect(merged.title).not.toMatch(/[<>]/);
  });
});
