import { expect, test } from '#e2e/fixtures.ts'

const POST = 'https://www.reddit.com/r/HistoryOfAustria/comments/1xq64ex/the_oldest_mine/'
const ARTICLE = 'https://news.example/the-oldest-mine'
const PREVIEW = 'https://external-preview.redd.it/the-oldest-mine.svg?width=1080'

const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="608" viewBox="0 0 1080 608">
<rect width="1080" height="608" fill="#5b4a3a"/><circle cx="540" cy="300" r="160" fill="#c9a24b"/>
<text x="540" y="540" font-family="sans-serif" font-size="48" fill="#fff" text-anchor="middle">The oldest mine</text></svg>`

// A link post with no text and no comments, as Reddit draws it: the page it links to shown by Reddit's preview of it.
function postPage(media: string) {
  return `<!doctype html><title>The oldest mine : r/HistoryOfAustria</title>
<shreddit-post post-type="link" author="Turtle456" post-title="The oldest mine" comment-count="0"
  permalink="/r/HistoryOfAustria/comments/1xq64ex/the_oldest_mine/" content-href="${ARTICLE}">
  <div slot="post-media-container">${media}</div>
</shreddit-post>`
}

test('a Reddit link post shows Reddit\'s preview of the page it links to in Read', async ({ app, site }) => {
  site.serve(POST, postPage(`<a href="${ARTICLE}">
    <img class="post-background-image-filter" src="https://external-preview.redd.it/the-oldest-mine.svg?width=108&blur=40">
    <img class="preview-img" src="${PREVIEW.replace('1080', '640')}" srcset="${PREVIEW.replace('1080', '640')} 640w, ${PREVIEW} 1080w" alt=""></a>`))
  site.serve(PREVIEW, { headers: { 'Content-Type': 'image/svg+xml' }, body: preview })
  await app.scrape(POST)
  await app.go(`#/?q=${encodeURIComponent(`item="${POST}"`)}&v=record`)
  const picture = app.page.locator('.reader-figure img')
  await expect(picture).toHaveAttribute('src', PREVIEW)
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await expect(app.page.locator('.reader-aside .reader-byline').getByRole('link', { name: 'Turtle456' })).toBeVisible()
  if (process.env.SHOT) {
    await app.page.screenshot({ path: process.env.SHOT })
  }
})

test('a link post with nothing else to show is headed by its title, linking to the page it links to', async ({ app, site }) => {
  site.serve(POST, postPage(''))
  await app.scrape(POST)
  await app.go(`#/?q=${encodeURIComponent(`item="${POST}"`)}&v=record`)
  const head = app.page.locator('.reader-viewport .reader-post')
  await expect(head.getByRole('heading', { name: 'The oldest mine' }).getByRole('link')).toHaveAttribute('href', ARTICLE)
  await expect(head).not.toContainText('Turtle456')
  await expect(app.page.locator('.reader-aside .reader-byline').getByRole('link', { name: 'Turtle456' })).toBeVisible()
  await expect(app.page.locator('.reader-viewport')).not.toContainText('no content')
})
