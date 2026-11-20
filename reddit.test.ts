import { afterEach, describe, expect, it, vi } from 'vitest'
import { itemSource, parserLoader, resetPage, setSiteRules, useSourceRules, visit } from '#scraper-test'

// The parser, evaluated with the helpers it is injected with, as a scrape runs it.
const load = parserLoader(__dirname)

afterEach(resetPage)

describe('listings', () => {
  it('marks a Reddit listing', async () => {
    const { parseReddit } = load('reddit.js', ['parseReddit'])
    visit('https://www.reddit.com/r/programming/', '<div id="siteTable"><div class="thing link" data-permalink="/r/programming/comments/a/one/"></div></div>')
    expect((await parseReddit()).listing).toBe(true)
  })
})

describe('sites\' own searches', () => {
  it('reads a Reddit search as a listing of the posts it found, a comment found standing for its post', async () => {
    visit('https://www.reddit.com/search/?q=rust', `
      <a href="/r/rust/">r/rust</a>
      <a data-testid="post-title" href="/r/rust/comments/abc/async_rust/">Async Rust</a>
      <a href="/r/programming/comments/def/why_rust/ghi/">a comment</a>
      <a data-testid="post-title" href="/r/rust/comments/abc/async_rust/">Async Rust again</a>`)
    expect(await load('reddit.js', ['parseReddit']).parseReddit()).toEqual({
      listing: true,
      content: [],
      links: [
        { url: 'https://www.reddit.com/r/rust/comments/abc/async_rust/', title: 'Async Rust', score: 1 },
        { url: 'https://www.reddit.com/r/programming/comments/def/why_rust/', title: 'a comment', score: 1 / 1.1 },
      ],
    })
  })
})

describe('reddit', () => {
  const { isListing, listingLinks, parseReddit, postLinks, postContent } = load('reddit.js', ['isListing', 'listingLinks', 'parseReddit', 'postLinks', 'postContent'])

  it('reads a post as its text, then each comment\'s head and text, in the thread\'s order', () => {
    visit('https://www.reddit.com/r/programming/comments/a/one/', `
      <shreddit-post post-title="One" author="cat"><div slot="text-body"><div class="md"><p>Why?</p><ul><li><p>Asking</p></li><li><p>for a friend</p></li></ul></div></div></shreddit-post>
      <shreddit-comment-tree>
        <shreddit-comment author="ann" score="12" permalink="/r/programming/comments/a/comment/c1/">
          <faceplate-timeago ts="2026-11-01T21:06:00.000000+0000"></faceplate-timeago><div slot="comment"><p>Because.</p><p>Truly.</p></div>
          <shreddit-comment author="bob" score="1" depth="1" slot="children"><div slot="comment"><p>Agreed.</p></div></shreddit-comment>
        </shreddit-comment>
        <shreddit-comment author="cat" score="-3"><div slot="comment"><p>No.</p></div></shreddit-comment>
      </shreddit-comment-tree>`)
    expect(postContent()).toEqual({
      title: 'One',
      content: [
        'Why?',
        'Asking',
        'for a friend',
        '<comment depth="0" author="ann" author-url="https://www.reddit.com/user/ann/" score="12" time="2026-11-01T21:06:00.000Z" url="https://www.reddit.com/r/programming/comments/a/comment/c1/">',
        'Because.',
        'Truly.',
        '<comment depth="1" author="bob" author-url="https://www.reddit.com/user/bob/" score="1">',
        'Agreed.',
        '<comment depth="0" author="cat" author-url="https://www.reddit.com/user/cat/" score="-3" op>',
        'No.',
      ],
    })
  })

  it('reads an old Reddit post the same way', () => {
    visit('https://old.reddit.com/r/programming/comments/a/one/', `
      <div id="siteTable"><div class="thing link" data-author="bob"><a class="title">One</a><div class="usertext-body"><div class="md"><p>Why?</p></div></div></div></div>
      <div class="commentarea"><div class="sitetable nestedlisting">
        <div class="thing comment" data-author="ann" data-permalink="/r/programming/comments/a/one/c1/"><div class="entry">
          <p class="tagline"><a class="author">ann</a> <span class="score unvoted" title="12">12 points</span> <time datetime="2026-11-01T21:06:00+00:00">1 day ago</time></p>
          <div class="usertext-body"><div class="md"><p>Because.</p></div></div></div>
          <div class="child"><div class="sitetable">
            <div class="thing comment" data-author="bob"><div class="entry"><a class="author">bob</a><div class="usertext-body"><div class="md"><p>Agreed.</p></div></div></div></div>
          </div></div>
        </div>
      </div></div>`)
    expect(postContent()).toEqual({
      title: 'One',
      content: [
        'Why?',
        '<comment depth="0" author="ann" author-url="https://old.reddit.com/user/ann/" score="12" time="2026-11-01T21:06:00.000Z" url="https://old.reddit.com/r/programming/comments/a/one/c1/">',
        'Because.',
        '<comment depth="1" author="bob" author-url="https://old.reddit.com/user/bob/" op>',
        'Agreed.',
      ],
    })
  })

  it('links a post to its subreddit, modern or old Reddit, but not a post to a user\'s profile', async () => {
    visit('https://www.reddit.com/r/IndieGaming/comments/a/one/', '<shreddit-post post-title="One" author="ann" comment-count="0" subreddit-name="IndieGaming"></shreddit-post>')
    expect((await parseReddit()).links).toEqual([
      { url: 'https://www.reddit.com/user/ann/', score: 1 },
      { url: 'https://www.reddit.com/r/IndieGaming/', score: 1 },
    ])
    visit('https://old.reddit.com/r/programming/comments/a/one/', '<div id="siteTable"><div class="thing link" data-permalink="/r/programming/comments/a/one/"><a class="title">One</a></div></div>')
    expect((await parseReddit()).links).toEqual([{ url: 'https://old.reddit.com/r/programming/', score: 1 }])
    visit('https://www.reddit.com/user/ann/comments/a/one/', '<shreddit-post post-title="One" author="ann" comment-count="0" subreddit-name="u_ann" permalink="/user/ann/comments/a/one/"></shreddit-post>')
    expect((await parseReddit()).links).toEqual([{ url: 'https://www.reddit.com/user/ann/', score: 1 }])
  })

  it('names what a link post discusses, but a text post discusses nothing', async () => {
    visit('https://www.reddit.com/r/a/comments/a/one/', '<shreddit-post post-title="One" comment-count="0" content-href="https://a.example/post"></shreddit-post>')
    expect((await parseReddit()).discussionOf).toBe('https://a.example/post')
    visit('https://www.reddit.com/r/a/comments/b/two/', '<shreddit-post post-title="Two" comment-count="0" content-href="https://www.reddit.com/r/a/comments/b/two/"></shreddit-post>')
    expect((await parseReddit()).discussionOf).toBeUndefined()
  })

  it('reads a post without comments at once, so a slow page is not timed out', async () => {
    vi.useFakeTimers()
    try {
      visit('https://www.reddit.com/r/gifs/comments/a/one/', '<shreddit-post post-title="One" comment-count="0" content-href="https://i.redd.it/a.gif"></shreddit-post>')
      const parsed = parseReddit()
      await vi.advanceTimersByTimeAsync(0)
      expect(await parsed).toEqual({ title: 'One', content: ['<post title="One">', '![](https://i.redd.it/a.gif)'], links: [] })
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for a post page\'s comments to appear', async () => {
    vi.useFakeTimers()
    try {
      visit('https://www.reddit.com/r/a/comments/a/one/', '<shreddit-post post-title="One" comment-count="1"></shreddit-post><shreddit-comment-tree></shreddit-comment-tree>')
      const parsed = parseReddit()
      await vi.advanceTimersByTimeAsync(1000)
      document.querySelector('shreddit-comment-tree')!.innerHTML = '<shreddit-comment author="ann"><div slot="comment"><p>Hi.</p></div></shreddit-comment>'
      await vi.advanceTimersByTimeAsync(200)
      expect((await parsed).content).toEqual(['<post title="One">', '<comment depth="0" author="ann" author-url="https://www.reddit.com/user/ann/">', 'Hi.'])
    } finally {
      vi.useRealTimers()
    }
  })

  describe('a post page\'s comments and video, fetched', () => {
    const respond = (body: string, ok = true) => Promise.resolve({ ok, text: () => Promise.resolve(body) })
    // As Reddit writes a comment: its parts slotted deep inside a <details>, its replies after them.
    const comment = (author: string, text: string, replies = '') => `<shreddit-comment author="${author}"><details><summary>
      <div slot="commentAvatar"></div></summary><div><div slot="comment"><p>${text}</p></div></div>${replies}</details></shreddit-comment>`
    const modules = '/svc/shreddit/post-detail-modules/r/a/one?render-mode=partial'

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('fetches the partial that loads a post\'s comments when they have not appeared', async () => {
      const fetch = vi.fn((_url: string) => respond(`<shreddit-comment-tree>${comment('ann', 'Hi.', comment('bob', 'Hey.'))}</shreddit-comment-tree>`))
      vi.stubGlobal('fetch', fetch)
      visit('https://www.reddit.com/r/a/comments/one/x/', `<shreddit-post post-title="One" comment-count="2"></shreddit-post>
        <faceplate-partial src="${modules}" loading="preload"></faceplate-partial>`)

      vi.useFakeTimers()
      let parsed
      try {
        const parsing = parseReddit()
        await vi.advanceTimersByTimeAsync(2200)
        parsed = await parsing
      } finally {
        vi.useRealTimers()
      }

      expect(fetch.mock.calls.map(([url]) => url)).toEqual([`https://www.reddit.com${modules}`])
      expect(parsed.content).toEqual([
        '<post title="One">',
        '<comment depth="0" author="ann" author-url="https://www.reddit.com/user/ann/">',
        'Hi.',
        '<comment depth="1" author="bob" author-url="https://www.reddit.com/user/bob/">',
        'Hey.',
      ])
    })

    it('shows a RedGIFs post\'s video, with sound, as its watch page\'s metadata names it', async () => {
      const meta = { video: { contentUrl: 'https://media.redgifs.com/YellowishFaraway-silent.mp4', thumbnailUrl: 'https://media.redgifs.com/YellowishFaraway-poster.jpg' } }
      // RedGIFs lets no other site read its pages, so the extension's background fetches it.
      const sendMessage = vi.fn((_message: any) => Promise.resolve({ text: `<script type="application/ld+json">${JSON.stringify(meta)}</script>` }))
      vi.stubGlobal('browser', { runtime: { sendMessage } })
      visit('https://www.reddit.com/r/a/comments/one/x/', '<shreddit-post post-title="One" comment-count="0" content-href="https://www.redgifs.com/watch/yellowishfaraway"></shreddit-post>')

      const parsed = await parseReddit()

      expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([{ type: 'fetch_text', url: 'https://www.redgifs.com/watch/yellowishfaraway' }])
      expect(parsed.content).toEqual(['<post title="One" url="https://www.redgifs.com/watch/yellowishfaraway">', '[![](https://media.redgifs.com/YellowishFaraway-poster.jpg)](https://media.redgifs.com/YellowishFaraway.mp4)'])
      expect(parsed.links).toEqual([{ url: 'https://www.redgifs.com/watch/yellowishfaraway', score: 1 }])
    })

    it('shows a video hosted by Reddit as its playlist, which needs no signature, with its poster frame', async () => {
      visit('https://www.reddit.com/r/a/comments/one/x/', `<shreddit-post post-title="One" comment-count="0" post-type="video" content-href="https://v.redd.it/br1maarty7zh1">
        <shreddit-player src="https://v.redd.it/br1maarty7zh1/HLSPlaylist.m3u8?f=hd&amp;v=1&amp;a=1796242733%2CMTkz" poster="https://external-preview.redd.it/a.png?width=640&amp;s=f9ba"></shreddit-player>
        <div slot="text-body"><p>Hello!</p></div></shreddit-post>`)

      const parsed = await parseReddit()

      expect(parsed.content).toEqual(['<post title="One">', '[![](https://external-preview.redd.it/a.png?width=640&s=f9ba)](https://v.redd.it/br1maarty7zh1/HLSPlaylist.m3u8)', 'Hello!'])
      expect(parsed.links).toEqual([])
    })

    it('shows a crossposted Reddit video from its player if the original cannot be fetched', async () => {
      vi.stubGlobal('fetch', vi.fn(() => respond('', false)))
      visit('https://www.reddit.com/r/a/comments/one/x/', `<shreddit-post post-title="One" comment-count="0" content-href="/r/b/comments/two/y/">
        <shreddit-player-2 src="https://v.redd.it/abc/HLSPlaylist.m3u8?a=1"></shreddit-player-2></shreddit-post>`)

      expect((await parseReddit()).content).toEqual(['<post title="One">', '[![]()](https://v.redd.it/abc/HLSPlaylist.m3u8)'])
    })

    it('shows a YouTube video a post links to, with its poster frame, and links to it', async () => {
      visit('https://www.reddit.com/r/a/comments/one/x/', `<shreddit-post post-title="One" comment-count="0" content-href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=12">
        <div slot="text-body"><p>Hey all!</p></div></shreddit-post>`)

      const parsed = await parseReddit()

      expect(parsed.content).toEqual(['<post title="One" url="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=12">', '[![](https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg)](https://www.youtube.com/watch?v=dQw4w9WgXcQ)', 'Hey all!'])
      expect(parsed.links).toEqual([{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12', score: 1 }])
    })

    it.each([
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/live/dQw4w9WgXcQ',
    ])('reads the YouTube video of an old Reddit post linking to %s', async (link) => {
      visit('https://old.reddit.com/r/a/comments/one/x/', `<div id="siteTable"><div class="thing link" data-url="${link}"><a class="title">One</a></div></div>`)

      expect((await parseReddit()).content).toEqual([`<post title="One" url="${link}">`, '[![](https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg)](https://www.youtube.com/watch?v=dQw4w9WgXcQ)'])
    })

    it('reads a crossposted YouTube video from its embed if the original cannot be fetched', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
      visit('https://www.reddit.com/r/a/comments/one/x/', `<shreddit-post post-title="One" comment-count="0" content-href="/r/b/comments/two/y/">
        <shreddit-embed html="&lt;iframe src=&quot;https://www.youtube.com/embed/dQw4w9WgXcQ?feature=oembed&amp;enablejsapi=1&quot;&gt;&lt;/iframe&gt;"></shreddit-embed></shreddit-post>`)

      expect((await parseReddit()).content).toEqual(['<post title="One">', '[![](https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg)](https://www.youtube.com/watch?v=dQw4w9WgXcQ)'])
    })

    describe('a crosspost', () => {
      const crosspost = (attributes: string) => `<shreddit-post post-title="Mine" author="bob" comment-count="0" content-href="/r/b/comments/two/y/" ${attributes}></shreddit-post>`
      const stub = (pages: Record<string, string>) => {
        const fetch = vi.fn((url: string) => pages[url] === undefined ? respond('', false) : respond(pages[url]))
        vi.stubGlobal('fetch', fetch)
        return fetch
      }
      const original = 'https://www.reddit.com/r/b/comments/two/y/'
      const page = (attributes: string, body = '') => `<html><body><shreddit-post post-title="Theirs" author="ann" ${attributes}>${body}</shreddit-post></body></html>`

      it('shows the text of the post it embeds, under its own title and comments, and credits both authors', async () => {
        const fetch = stub({ [original]: page(`content-href="${original}"`, '<div slot="text-body"><div class="md"><p>Why?</p><p>Because.</p></div></div>') })
        visit('https://www.reddit.com/r/a/comments/one/x/', `${crosspost('')}
          <shreddit-comment author="cat"><div slot="comment"><p>Hi.</p></div></shreddit-comment>`)

        const parsed = await parseReddit()

        expect(fetch.mock.calls.map(([url]) => url)).toEqual([original])
        expect(parsed.title).toBe('Mine')
        expect(parsed.content).toEqual([
          '<post title="Mine" author="bob" author-url="https://www.reddit.com/user/bob/" author-2="ann" author-url-2="https://www.reddit.com/user/ann/">',
          'Why?',
          'Because.',
          '<comment depth="0" author="cat" author-url="https://www.reddit.com/user/cat/">',
          'Hi.',
        ])
        expect(parsed.links).toEqual([{ url: 'https://www.reddit.com/user/bob/', score: 1 }, { url: 'https://www.reddit.com/user/ann/', score: 1 }])
      })

      it('credits one author once when they crossposted their own post', async () => {
        stub({ [original]: '<shreddit-post author="bob"></shreddit-post>' })
        visit('https://www.reddit.com/r/a/comments/one/x/', crosspost(''))

        expect((await parseReddit()).links).toEqual([{ url: 'https://www.reddit.com/user/bob/', score: 1 }])
      })

      it('links to its subreddit and the original\'s, once if they are the same', async () => {
        stub({ [original]: page('subreddit-name="IndieGaming"') })
        visit('https://www.reddit.com/r/a/comments/one/x/', crosspost('subreddit-name="gaming"'))
        expect((await parseReddit()).links.slice(2)).toEqual([
          { url: 'https://www.reddit.com/r/gaming/', score: 1 },
          { url: 'https://www.reddit.com/r/IndieGaming/', score: 1 },
        ])

        stub({ [original]: page('subreddit-name="gaming"') })
        visit('https://www.reddit.com/r/a/comments/one/x/', crosspost('subreddit-name="Gaming"'))
        expect((await parseReddit()).links.slice(2)).toEqual([{ url: 'https://www.reddit.com/r/Gaming/', score: 1 }])
      })

      it('keeps text of its own before the text of the post it links to', async () => {
        stub({ [original]: page('', '<div slot="text-body"><p>Theirs.</p></div>') })
        visit('https://www.reddit.com/r/a/comments/one/x/', `<shreddit-post post-title="Mine" comment-count="0" content-href="/r/b/comments/two/y/"><div slot="text-body"><p>Mine.</p></div></shreddit-post>`)

        expect((await parseReddit()).content.filter((block: string) => !block.startsWith('<post'))).toEqual(['Mine.', 'Theirs.'])
      })

      it('links to what the post it embeds links to', async () => {
        stub({ [original]: page('content-href="https://a.example/story"') })
        visit('https://www.reddit.com/r/a/comments/one/x/', crosspost(''))

        const parsed = await parseReddit()

        expect(parsed.links[0]).toEqual({ url: 'https://a.example/story', score: 1 })
        expect(parsed.discussionOf).toBe('https://a.example/story')
      })

      it('shows the picture of the post it embeds', async () => {
        stub({ [original]: page('content-href="https://i.redd.it/abc.jpeg"') })
        visit('https://www.reddit.com/r/a/comments/one/x/', crosspost(''))

        expect((await parseReddit()).content).toContain('![](https://i.redd.it/abc.jpeg)')
      })

      it('shows the video of the post it embeds', async () => {
        stub({ [original]: page('content-href="https://v.redd.it/abc"', '<shreddit-player src="https://v.redd.it/abc/HLSPlaylist.m3u8?a=1" poster="https://a.example/p.png"></shreddit-player>') })
        visit('https://www.reddit.com/r/a/comments/one/x/', crosspost(''))

        expect((await parseReddit()).content).toContain('[![](https://a.example/p.png)](https://v.redd.it/abc/HLSPlaylist.m3u8)')
      })

      it('follows a crosspost of a crosspost to the first', async () => {
        const first = 'https://www.reddit.com/r/c/comments/three/z/'
        stub({
          [original]: page(`content-href="${first}"`),
          [first]: page(`content-href="${first}"`, '<div slot="text-body"><p>Why?</p></div>'),
        })
        visit('https://www.reddit.com/r/a/comments/one/x/', crosspost(''))

        expect((await parseReddit()).content).toContain('Why?')
      })

      it('fetches the original from the site being read, as old Reddit shows it', async () => {
        const fetch = stub({ 'https://old.reddit.com/r/b/comments/two/y/': `<div id="siteTable"><div class="thing link" data-url="/r/b/comments/two/y/" data-author="ann"><a class="title">Theirs</a>
          <div class="usertext-body"><div class="md"><p>Why?</p></div></div></div></div>` })
        visit('https://old.reddit.com/r/a/comments/one/x/', '<div id="siteTable"><div class="thing link" data-url="https://www.reddit.com/r/b/comments/two/y/" data-author="bob"><a class="title">Mine</a></div></div>')

        const parsed = await parseReddit()

        expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://old.reddit.com/r/b/comments/two/y/'])
        expect(parsed.title).toBe('Mine')
        expect(parsed.content).toContain('Why?')
      })

      it('fetches nothing for a post that links to itself', async () => {
        const fetch = stub({})
        visit('https://www.reddit.com/r/b/comments/two/y/', '<shreddit-post post-title="Theirs" comment-count="0" content-href="/r/b/comments/two/y/"><div slot="text-body"><p>Why?</p></div></shreddit-post>')

        expect((await parseReddit()).content).toEqual(['<post title="Theirs">', 'Why?'])
        expect(fetch).not.toHaveBeenCalled()
      })
    })

    it('reads a RedGIFs post without its video when the watch page cannot be fetched', async () => {
      vi.stubGlobal('browser', { runtime: { sendMessage: () => Promise.resolve({ text: null }) } })
      visit('https://www.reddit.com/r/a/comments/one/x/', '<shreddit-post post-title="One" comment-count="0" content-href="https://www.redgifs.com/watch/a"></shreddit-post>')

      expect((await parseReddit()).content).toEqual(['<post title="One" url="https://www.redgifs.com/watch/a">'])
    })
  })

  it('tells listings from posts', () => {
    expect(['/', '/r/programming/', '/r/programming/new/', '/best/', '/user/someone/', '/user/someone/submitted/', '/user/someone/comments/'].every(isListing)).toBe(true)
    expect(['/r/programming/comments/abc/title/', '/user/someone/comments/abc/title/'].some(isListing)).toBe(false)
  })

  it('links a listing to each post\'s comments, leaving out ads', () => {
    visit('https://www.reddit.com/r/programming/', `
      <shreddit-post permalink="/r/programming/comments/a/one/" content-href="https://a.example/" post-title="One"></shreddit-post>
      <shreddit-post promoted permalink="/r/programming/comments/b/ad/" post-title="Ad"></shreddit-post>
      <shreddit-post permalink="/r/programming/comments/c/three/" post-title="Three"></shreddit-post>`)
    expect(listingLinks().map((l: any) => [l.url, l.title])).toEqual([
      ['https://www.reddit.com/r/programming/comments/a/one/', 'One'],
      ['https://www.reddit.com/r/programming/comments/c/three/', 'Three'],
    ])
  })

  it('gives each listed post the picture the listing shows of it, but not its blurred backdrop nor an avatar', () => {
    visit('https://www.reddit.com/r/programming/', `
      <shreddit-post permalink="/r/programming/comments/a/one/" post-title="One">
        <img src="https://www.redditstatic.com/avatars/a.png" alt="u/a avatar">
        <img class="post-background-image-filter" src="https://cf.preview.redd.it/blurred.png">
        <img data-post-media-primary src="https://preview.redd.it/one.png?width=640">
      </shreddit-post>
      <shreddit-post permalink="/r/programming/comments/b/two/" post-title="Two"><img slot="poster" src="https://external-preview.redd.it/two.png"></shreddit-post>
      <shreddit-post permalink="/r/programming/comments/c/three/" post-title="Three"><p>Text</p></shreddit-post>`)
    expect(listingLinks().map((l: any) => l.picture)).toEqual(['https://preview.redd.it/one.png?width=640', 'https://external-preview.redd.it/two.png', undefined])
  })

  it('gives an old Reddit post its thumbnail', () => {
    visit('https://old.reddit.com/r/programming/', `<div id="siteTable">
      <div class="thing link" data-permalink="/r/programming/comments/a/one/"><a class="thumbnail"><img src="//b.thumbs.redditmedia.com/one.jpg"></a><a class="title">One</a></div>
    </div>`)
    expect(listingLinks()[0].picture).toBe('https://b.thumbs.redditmedia.com/one.jpg')
  })

  it('waits for a listing\'s posts to appear', async () => {
    vi.useFakeTimers()
    try {
      visit('https://www.reddit.com/', '<shreddit-feed></shreddit-feed>')
      const parsed = parseReddit()
      await vi.advanceTimersByTimeAsync(6000)
      document.querySelector('shreddit-feed')!.innerHTML = '<shreddit-post permalink="/r/a/comments/a/one/" post-title="One"></shreddit-post>'
      await vi.advanceTimersByTimeAsync(200)
      expect((await parsed).links.map((l: any) => l.url)).toEqual(['https://www.reddit.com/r/a/comments/a/one/'])
    } finally {
      vi.useRealTimers()
    }
  })

  describe('a listing\'s further pages', () => {
    const post = (id: string, attrs = '') => `<shreddit-post ${attrs} permalink="/r/a/comments/${id}/" post-title="${id}"></shreddit-post>`
    const feed = (posts: string[], nextSrc?: string) => `<shreddit-feed>${posts.map(p => `<article>${p}</article>`).join('')}${
      nextSrc ? `<faceplate-partial slot="load-after" loading="programmatic" src="${nextSrc}"></faceplate-partial>` : ''}</shreddit-feed>`
    const respond = (body: string, ok = true) => Promise.resolve({ ok, text: () => Promise.resolve(body) })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('fetches the pages the feed would load as it is scrolled, until it has as many posts as a tab shows', async () => {
      const pages: Record<string, string> = {
        'https://www.reddit.com/svc/feed?after=1': feed([post('one'), post('two'), post('ad', 'promoted')], '/svc/feed?after=2'),
        'https://www.reddit.com/svc/feed?after=2': feed(Array.from({ length: 30 }, (_, i) => post(`p${i}`)), '/svc/feed?after=3'),
      }
      const fetch = vi.fn((url: string) => respond(pages[url]))
      vi.stubGlobal('fetch', fetch)
      visit('https://www.reddit.com/', feed([post('one')], '/svc/feed?after=1'))

      const { links } = await parseReddit()

      expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://www.reddit.com/svc/feed?after=1', 'https://www.reddit.com/svc/feed?after=2'])
      expect(links.slice(0, 3).map((l: any) => l.url)).toEqual(['one', 'two', 'p0'].map(id => `https://www.reddit.com/r/a/comments/${id}/`))
      expect(links).toHaveLength(32)
    })

    it('fetches nothing once the feed has loaded as many posts as a tab shows', async () => {
      const fetch = vi.fn()
      vi.stubGlobal('fetch', fetch)
      visit('https://www.reddit.com/', feed(Array.from({ length: 28 }, (_, i) => post(`p${i}`)), '/svc/feed?after=1'))

      expect((await parseReddit()).links).toHaveLength(28)
      expect(fetch).not.toHaveBeenCalled()
    })

    it('reads only posts from joined subreddits on a logged-in front page, fetching further pages to make up the rest', async () => {
      const joined = (id: string) => post(id, 'user-logged-in is-subscribed')
      const fetch = vi.fn(() => respond(feed(Array.from({ length: 30 }, (_, i) => joined(`p${i}`)))))
      vi.stubGlobal('fetch', fetch)
      visit('https://www.reddit.com/', feed([joined('one'), post('suggested', 'user-logged-in recommendation-source="user_post_share"')], '/svc/feed?after=1'))

      const { links } = await parseReddit()

      expect(links.slice(0, 2).map((l: any) => l.url)).toEqual(['one', 'p0'].map(id => `https://www.reddit.com/r/a/comments/${id}/`))
      expect(links.some((l: any) => l.url.includes('suggested'))).toBe(false)
    })

    it('reads every post of a subreddit\'s own listing, joined or not', async () => {
      vi.stubGlobal('fetch', vi.fn(() => respond('', false)))
      visit('https://www.reddit.com/r/a/', feed([post('one', 'user-logged-in')], '/svc/feed?after=1'))

      expect((await parseReddit()).links.map((l: any) => l.url)).toEqual(['https://www.reddit.com/r/a/comments/one/'])
    })

    it('keeps the posts it has when a page cannot be fetched', async () => {
      vi.stubGlobal('fetch', vi.fn(() => respond('', false)))
      visit('https://www.reddit.com/', feed([post('one')], '/svc/feed?after=1'))

      expect((await parseReddit()).links.map((l: any) => l.url)).toEqual(['https://www.reddit.com/r/a/comments/one/'])
    })
  })

  it('links an old Reddit listing to each post\'s comments', () => {
    visit('https://old.reddit.com/r/programming/', `<div id="siteTable">
      <div class="thing link" data-permalink="/r/programming/comments/a/one/"><a class="title">One</a></div>
      <div class="thing link promoted" data-permalink="/r/programming/comments/b/ad/"><a class="title">Ad</a></div>
    </div>`)
    expect(listingLinks().map((l: any) => l.url)).toEqual(['https://old.reddit.com/r/programming/comments/a/one/'])
  })

  it('shows an image post\'s picture full size rather than linking to it', () => {
    visit('https://www.reddit.com/r/pics/comments/a/one/', `
      <shreddit-post post-type="image" post-title="One" content-href="https://i.redd.it/abc.jpeg">
        <div slot="post-media-container"><img id="post-image" src="https://preview.redd.it/abc.jpeg?width=640" alt="r/pics - One"></div>
      </shreddit-post>`)
    expect(postContent()).toEqual({ title: 'One', content: ['![](https://i.redd.it/abc.jpeg)'] })
    expect(postLinks()).toEqual([])
  })

  it('keeps a gallery picture once, full size, with the caption new Reddit puts in its alt text', () => {
    const slide = (id: string, alt: string) => `<li><figure>
      <img class="post-background-image-filter" src="https://cf.preview.redd.it/${id}-blur.png">
      <img class="non-lightboxed-content" src="https://cf.preview.redd.it/${id}.png" alt="${alt}">
      <div class="lightboxed-content hidden"><zoomable-img><img src="https://i.redd.it/${id}.png" alt="${alt}"></zoomable-img></div>
    </figure></li>`
    visit('https://www.reddit.com/r/games/comments/a/one/', `
      <shreddit-post post-type="gallery" post-title="One" content-href="https://www.reddit.com/gallery/a">
        <gallery-carousel><ul>${slide('x', 'r/games - The garden')}${slide('y', 'r/games - One')}</ul></gallery-carousel>
      </shreddit-post>`)
    expect(postContent()).toEqual({
      title: 'One',
      content: ['![The garden](https://i.redd.it/x.png)', '![](https://i.redd.it/y.png)'],
    })
  })

  it('reads a gallery as each of its pictures, the largest offered, with its poster\'s captions', () => {
    visit('https://www.reddit.com/r/pics/comments/a/one/', `
      <shreddit-post post-type="gallery" post-title="One" content-href="https://www.reddit.com/gallery/a">
        <gallery-carousel><ul>
          <li><figure>
            <img class="post-background-image-filter" src="https://preview.redd.it/x.jpg?width=108&blur=40">
            <img class="media-lightbox-img" src="https://preview.redd.it/x.jpg?width=640" srcset="https://preview.redd.it/x.jpg?width=640 640w, https://preview.redd.it/x.jpg?width=1080 1080w" alt="r/pics - One">
            <figcaption>The first</figcaption>
          </figure></li>
          <li><figure><img class="media-lightbox-img" data-lazy-src="https://preview.redd.it/y.jpg?width=640" alt="r/pics - One"></figure></li>
        </ul></gallery-carousel>
        <div slot="text-body"><p>Two pictures.</p></div>
      </shreddit-post>`)
    expect(postContent()).toEqual({
      title: 'One',
      content: ['![The first](https://preview.redd.it/x.jpg?width=1080)', '![](https://preview.redd.it/y.jpg?width=640)', 'Two pictures.'],
    })
    expect(postLinks()).toEqual([])
  })

  it('shows a link post\'s preview of the page it links to, the largest offered, and still links to the page', () => {
    visit('https://www.reddit.com/r/history/comments/a/one/', `
      <shreddit-post post-type="link" post-title="One" content-href="https://news.example/mining">
        <img src="https://styles.redditmedia.com/t5_1/styles/communityIcon_x.png" width="24">
        <div slot="post-media-container"><a href="https://news.example/mining">
          <img class="post-background-image-filter" src="https://external-preview.redd.it/x.jpg?width=108&blur=40">
          <img class="preview-img" src="https://external-preview.redd.it/x.jpg?width=640" srcset="https://external-preview.redd.it/x.jpg?width=640 640w, https://external-preview.redd.it/x.jpg?width=1080 1080w" alt="One">
        </a></div>
      </shreddit-post>`)
    expect(postContent()).toEqual({ title: 'One', content: ['![](https://external-preview.redd.it/x.jpg?width=1080)'] })
    expect(postLinks()).toEqual([{ url: 'https://news.example/mining', score: 1 }])
  })

  it('shows nothing for a link post without a preview, nor a text post\'s own pictures as one', () => {
    visit('https://www.reddit.com/r/history/comments/a/one/', `
      <shreddit-post post-type="link" post-title="One" content-href="https://news.example/mining">
        <div slot="text-body"><p>Read this.</p><img src="https://preview.redd.it/inline.png?width=640" width="640"></div>
      </shreddit-post>`)
    expect(postContent()).toEqual({ title: 'One', content: ['Read this.'] })
  })

  it('shows an old Reddit image post\'s picture', () => {
    visit('https://old.reddit.com/r/pics/comments/a/one/', `
      <div id="siteTable"><div class="thing link" data-url="https://i.imgur.com/abc.png"><a class="title">One</a></div></div>`)
    expect(postContent()).toEqual({ title: 'One', content: ['![](https://i.imgur.com/abc.png)'] })
    expect(postLinks()).toEqual([])
  })

  it('links a post to what it links to, but not a text post to itself', () => {
    visit('https://www.reddit.com/r/programming/comments/a/one/', '<shreddit-post content-href="https://a.example/"></shreddit-post>')
    expect(postLinks()).toEqual([{ url: 'https://a.example/', score: 1 }])
    visit('https://www.reddit.com/r/programming/comments/c/three/', '<shreddit-post content-href="https://www.reddit.com/r/programming/comments/c/three/"></shreddit-post>')
    expect(postLinks()).toEqual([])
  })
})

describe('authors', () => {
  describe('reddit', () => {
    const { parseReddit } = load('reddit.js', ['parseReddit'])

    it('heads a modern post with its title, author, score and time, and links to their page', async () => {
      visit('https://www.reddit.com/r/a/comments/a/one/', `<shreddit-post post-title="One" author="cat" score="42" created-timestamp="2026-11-13T06:45:12.000000+0000"
        comment-count="0"><div slot="text-body"><div class="md"><p>Why?</p></div></div></shreddit-post>`)
      const parsed = await parseReddit()
      expect(parsed.content).toEqual([
        '<post title="One" author="cat" author-url="https://www.reddit.com/user/cat/" score="42" time="2026-11-13T06:45:12.000Z">',
        'Why?',
      ])
      expect(parsed.links).toEqual([{ url: 'https://www.reddit.com/user/cat/', score: 1 }])
    })

    it('heads an old Reddit post the same way, with the page it links to', async () => {
      visit('https://old.reddit.com/r/a/comments/a/one/', `<div id="siteTable"><div class="thing link" data-author="bob" data-score="7" data-comments-count="0"
        data-url="https://a.example/story"><a class="title">One</a><p class="tagline"><time datetime="2026-11-01T21:06:00+00:00">1 day ago</time></p></div></div>`)
      const parsed = await parseReddit()
      expect(parsed.content).toEqual([
        '<post title="One" url="https://a.example/story" author="bob" author-url="https://old.reddit.com/user/bob/" score="7" time="2026-11-01T21:06:00.000Z">',
      ])
      expect(parsed.links).toEqual([{ url: 'https://a.example/story', score: 1 }, { url: 'https://old.reddit.com/user/bob/', score: 1 }])
    })

    it('names no author of a deleted post', async () => {
      visit('https://www.reddit.com/r/a/comments/a/one/', '<shreddit-post post-title="One" author="[deleted]" comment-count="0"><div slot="text-body"><div class="md"><p>Why?</p></div></div></shreddit-post>')
      const parsed = await parseReddit()
      expect(parsed.content).toEqual(['<post title="One">', 'Why?'])
      expect(parsed.links).toEqual([])
    })
  })
})

describe('author pages', () => {
  describe('reddit', () => {
    const { parseReddit } = load('reddit.js', ['parseReddit'])

    it('links a user\'s page to each of their posts, from any subreddit, logged in or not', async () => {
      visit('https://www.reddit.com/user/ann/submitted/', `
        <shreddit-post user-logged-in post-title="One" permalink="/r/a/comments/1/one/"></shreddit-post>
        <shreddit-post user-logged-in promoted post-title="Ad" permalink="/r/a/comments/2/ad/"></shreddit-post>`)
      expect((await parseReddit()).links.map((link: any) => link.url)).toEqual(['https://www.reddit.com/r/a/comments/1/one/'])
    })

    // As Reddit's profile comments have it, the comment's own link above the one to its post.
    const profileComment = (post: string, title: string, id: string) => `
      <shreddit-profile-comment href="/r/a/comments/${post.split('/')[0]}/comment/${id}/?context=3">
        <a href="/r/a/comments/${post.split('/')[0]}/comment/${id}/?context=3"></a>
        <h2><a href="/r/a/comments/${post}/"> ${title} </a></h2>
        <div class="md"><p><a href="/r/b/comments/9/elsewhere/">a link in the comment</a></p></div>
      </shreddit-profile-comment>`

    it('links a user\'s page to the posts they commented on, below their own, in page order', async () => {
      visit('https://www.reddit.com/user/ann/', `<shreddit-feed>
        ${profileComment('1/one', 'One', 'c1')}
        <shreddit-post post-title="Two" permalink="/r/a/comments/2/two/"></shreddit-post>
      </shreddit-feed>`)
      expect((await parseReddit()).links).toEqual([
        { url: 'https://www.reddit.com/r/a/comments/1/one/', title: 'One', score: 0.5 },
        { url: 'https://www.reddit.com/r/a/comments/2/two/', title: 'Two', score: 1 / 1.1 },
      ])
    })

    it('links a post once, however many comments the user made on it, and as their own if it is', async () => {
      visit('https://www.reddit.com/user/ann/', `<shreddit-feed>
        ${profileComment('1/one', 'One', 'c1')}
        ${profileComment('2/two', 'Two', 'c2')}
        ${profileComment('1/one', 'One', 'c3')}
        <shreddit-post post-title="Two" permalink="/r/a/comments/2/two/"></shreddit-post>
      </shreddit-feed>`)
      expect((await parseReddit()).links.map(({ url, score }: any) => [url, score])).toEqual([
        ['https://www.reddit.com/r/a/comments/1/one/', 0.5],
        ['https://www.reddit.com/r/a/comments/2/two/', 1 / 1.1],
      ])
    })

    it('reads a user\'s comments tab as a listing, its further pages included', async () => {
      const fetched = vi.fn(async () => new Response(`${profileComment('2/two', 'Two', 'c2')}<div slot="load-after"></div>`))
      vi.stubGlobal('fetch', fetched)
      visit('https://www.reddit.com/user/ann/comments/', `<shreddit-feed>
        ${profileComment('1/one', 'One', 'c1')}
        <faceplate-partial slot="load-after" src="/svc/shreddit/profiles/profile_comments-more-posts/new/?after=a"></faceplate-partial>
      </shreddit-feed>`)
      const parsed = await parseReddit()
      expect(fetched.mock.calls.map(([url]: any[]) => url)).toEqual(['https://www.reddit.com/svc/shreddit/profiles/profile_comments-more-posts/new/?after=a'])
      expect(parsed).toMatchObject({ listing: true, content: [] })
      expect(parsed.links.map((link: any) => link.url)).toEqual(['https://www.reddit.com/r/a/comments/1/one/', 'https://www.reddit.com/r/a/comments/2/two/'])
    })

    it('reads a post on a user\'s profile as a post, not their comments tab', async () => {
      visit('https://www.reddit.com/user/ann/comments/1/one/', '<shreddit-post author="ann" post-title="One"></shreddit-post>')
      const parsed = await parseReddit()
      expect(parsed.title).toBe('One')
      expect(parsed.listing).toBeUndefined()
    })

    it('reads an old Reddit user\'s page the same way', async () => {
      visit('https://old.reddit.com/user/ann/', '<div id="siteTable"><div class="thing link" data-permalink="/r/a/comments/1/one/"><a class="title">One</a></div></div>')
      expect((await parseReddit()).links.map((link: any) => link.url)).toEqual(['https://old.reddit.com/r/a/comments/1/one/'])
    })
  })
})

describe('where its posts come from', () => {
  afterEach(() => setSiteRules([]))

  it('files a post under its community, as its source says', () => {
    useSourceRules(__dirname)
    expect(itemSource('https://www.reddit.com/r/gameideas/comments/1xm5s3r/devil_dice_but_on_mobile/')).toBe('reddit.com/r/gameideas')
    expect(itemSource('https://old.reddit.com/user/someone/comments/1xm5s3r/a_post/')).toBe('old.reddit.com/user/someone')
    expect(itemSource('https://www.reddit.com/r/gameideas/')).toBe('reddit.com/r/gameideas')
  })
})
