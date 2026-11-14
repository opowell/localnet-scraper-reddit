import type { Scenario } from '#e2e/scenarios/index.ts'

const POST = 'https://www.reddit.com/r/gamedev/comments/abc123/should_i_list_my_hobby_projects/'

function comment(author: string, depth: number, score: number, text: string) {
  return `<shreddit-comment author="${author}" depth="${depth}" score="${score}"
  created="2026-11-13T06:50:00Z" permalink="/r/gamedev/comments/abc123/comment/${author}/"><div slot="comment"><p>${text}</p></div></shreddit-comment>`
}

const page = `<!doctype html><title>Should I list my hobby projects? : r/gamedev</title>
<shreddit-post author="pond_dev" post-title="Should I list my hobby projects when applying for games industry jobs?" score="214"
  created-timestamp="2026-11-13T06:45:00.000000+0000" permalink="/r/gamedev/comments/abc123/should_i_list_my_hobby_projects/"
  comment-count="2"><div slot="text-body"><div class="md">
  <p>${'I have been making small games in my spare time for a few years, and some of them found an audience. '.repeat(3)}</p>
  <p>Should I put them front and centre on my CV? If so, how would you frame them?</p>
  <p>Any and all feedback is appreciated.</p></div></div></shreddit-post>
${comment('first_reader', 0, 13, 'Yes!')}
${comment('second_reader', 0, 41, 'Shipped work counts. Absolutely include it.')}`

export const redditPost: Scenario = {
  about: 'a Reddit text post with comments, read in Read',
  async run({ app, site }) {
    site.serve(POST, page)
    await app.scrape(POST)
    await app.go(`#/?q=${encodeURIComponent(`item="${POST}"`)}&v=record`)
    await app.page.locator('.reader-flow').waitFor()
    await app.page.waitForTimeout(500)
  },
}

export default redditPost
