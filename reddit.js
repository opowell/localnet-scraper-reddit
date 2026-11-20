// The front page or a subreddit, as listed by any of its sorts (/r/programming/new/).
function isListing(pathname) {
  return /^(?:\/r\/[^/]+)?\/?(?:(?:best|hot|new|top|rising|controversial)\/?)?$/.test(pathname)
    || /^\/user\/[^/]+\/(?:(?:overview|submitted|comments)\/?)?$/.test(pathname)
}

// Whether a listing post is from a subreddit to read: any, on a subreddit's own listing, but on the front page, which
// mixes in posts recommended from subreddits the user has not joined, only joined ones (when the user is logged in, as
// the page's own posts tell, for those of the pages fetched for it too).
function isFollowed(post) {
  return location.pathname.startsWith('/r/')
    || location.pathname.startsWith('/user/')
    || !document.querySelector('shreddit-post[user-logged-in]')
    || post.hasAttribute('is-subscribed')
}

// The post an element of a listing stands for: its comments page, title and link. A user's comment stands for the post
// it is on, which its head links to, and says so (commented).
function listedPost(element) {
  if (element.matches('shreddit-profile-comment')) {
    const post = element.querySelector('h2 a[href*="/comments/"]')
    return { permalink: post?.getAttribute('href'), title: post?.textContent.trim(), commented: true }
  }
  return {
    permalink: element.getAttribute('permalink'),
    url: element.getAttribute('content-href'),
    title: element.getAttribute('post-title'),
    picture: postPicture(element),
  }
}

// Where a listing shows a picture of a post, best first: its picture, its video's poster, its gallery's first slide, a
// link post's thumbnail (old Reddit's too). Not the blurred copy of a picture behind it, nor an avatar or icon.
const POST_PICTURES = [
  'img[data-post-media-primary]',
  'img[slot="poster"]',
  'gallery-carousel img[src]',
  'img[src*="preview.redd.it"]:not(.post-background-image-filter)',
  'img[src*="i.redd.it"]',
  'img[src*="thumbs.redditmedia.com"]',
  'a.thumbnail img',
]

// The address of the picture a listing shows of a post (see POST_PICTURES), if it shows one: a text post has none.
function postPicture(element) {
  for (const selector of POST_PICTURES) {
    const src = element.querySelector(selector)?.getAttribute('src')
    if (src && /^(?:https?:)?\/\//.test(src)) {
      return new URL(src, location.origin).href
    }
  }
  return undefined
}

// Each of these posts once, where it first stands: as a user's own post if they also commented on it.
function distinctPosts(posts) {
  const distinct = new Map()
  for (const post of posts) {
    if (!distinct.get(post.permalink) || (distinct.get(post.permalink).commented && !post.commented)) {
      distinct.set(post.permalink, post)
    }
  }
  return Array.from(distinct.values())
}

// The posts a listing shows, modern or old Reddit, in page order, without the ads among them or posts from subreddits
// it does not follow; root may be a page of its feed instead.
function listedPosts(root = document) {
  const modern = Array.from(root.querySelectorAll('shreddit-post:not([promoted]), shreddit-profile-comment'))
    .filter(isFollowed)
    .map(listedPost)
  const old = Array.from(root.querySelectorAll('#siteTable > .thing.link:not(.promoted)')).map(thing => ({
    permalink: thing.getAttribute('data-permalink'),
    url: thing.getAttribute('data-url'),
    title: thing.querySelector('a.title')?.textContent,
    picture: postPicture(thing),
  }))
  return distinctPosts([...modern, ...old].filter(post => post.permalink))
}

// How many posts a listing reads: about as many as it shows when opened in a tab of its own.
const LISTING_POSTS = 25

// A modern listing's posts, with those of each further page its feed would load as it is scrolled (its load-after
// partial), until there are LISTING_POSTS. A scrape's background tab seldom loads them itself, as the feed waits for
// the end of the posts to near the screen, so they are fetched here.
async function loadListedPosts() {
  let posts = listedPosts()
  let next = document.querySelector('shreddit-feed [slot="load-after"][src]')
  for (let pages = 0; next && posts.length < LISTING_POSTS && pages < 3; pages++) {
    try {
      const response = await pageFetch(new URL(next.getAttribute('src'), location.origin).href)
      if (!response.ok) {
        break
      }
      const page = new DOMParser().parseFromString(await response.text(), 'text/html')
      posts = distinctPosts([...posts, ...listedPosts(page)])
      next = page.querySelector('[slot="load-after"][src]')
    } catch {
      break
    }
  }
  return posts
}

// How strongly a user's page links to a post they commented on, compared to one of their own in its place.
const COMMENTED_POST_WEIGHT = 0.5

// A listing links to each post's comments, the higher ranked more strongly, with its title and the picture it shows.
function listingLinks(posts = listedPosts()) {
  return posts.map((post, rank) => ({
    url: new URL(post.permalink, location.origin).href,
    title: post.title,
    ...(post.picture ? { picture: post.picture } : {}),
    score: (post.commented ? COMMENTED_POST_WEIGHT : 1) / (1 + rank / 10),
  }))
}

// The post a post page shows, modern or old Reddit, in root, which may be a page fetched for it.
function pagePost(root = document) {
  return root.querySelector('shreddit-post, #siteTable > .thing.link')
}

// What a post links to: its content-href (modern) or data-url (old Reddit), if any.
function postHref(post) {
  const href = post?.getAttribute(post.matches('shreddit-post') ? 'content-href' : 'data-url')
  return href ? new URL(href, location.origin) : null
}

// A picture rather than a page: hosted by Reddit (i.redd.it) or named as one (i.imgur.com/abc.jpg).
function isPicture(url) {
  return url.hostname === 'i.redd.it' || /\.(?:jpe?g|png|gif|webp|avif)$/i.test(url.pathname)
}

// A post page links to what the post links to, unless it is a text post, a gallery, a picture or a video hosted by
// Reddit, which its content shows instead.
function postLinks(post = pagePost()) {
  const url = postHref(post)
  return !url || url.hostname.endsWith('reddit.com') || url.hostname.endsWith('redd.it') || isPicture(url)
    ? []
    : [{ url: url.href, score: 1 }]
}

// A gallery picture's caption, as its poster gave it, if any. New Reddit has it in the alt text alone
// ("r/IndieGaming - The caption"), which repeats the post's title on a picture with none.
function galleryCaption(img, title) {
  const caption = img.closest('figure, li, .gallery-tile')?.querySelector('figcaption, .gallery-item-caption')?.innerText.trim()
  const alt = /^r\/\w+ - (.+)/.exec(img.getAttribute('alt') || '')?.[1].trim()
  return caption || (alt !== title && alt) || ''
}

// Hosts of the pictures Reddit makes of what posts show: a linked page's preview (external-preview.redd.it), a
// picture's smaller copies ((cf.)preview.redd.it) and old thumbnails (b.thumbs.redditmedia.com).
function isPreview(src) {
  const host = src ? new URL(src).hostname : ''
  return host.endsWith('preview.redd.it') || host.endsWith('thumbs.redditmedia.com')
}

// A link post's preview, as a content block: the picture Reddit shows of the page it links to, the largest offered,
// which is what there is to see of a post with no text of its own. Not the blurred copy drawn behind it, nor a picture
// in the post's text. None for a post with no preview, or on old Reddit, whose thumbnails are too small to read.
function linkPreview(post) {
  const img = Array.from(post.querySelectorAll('img'))
    .filter(image => !image.closest('[slot="text-body"]') && !/background|blur/.test(image.getAttribute('class') || ''))
    .find(image => isPreview(imageSource(image)))
  return img ? imageBlock(img, '') : null
}

// The pictures a post shows, as content blocks: an image post's picture, full size, or each of a gallery's, with the
// caption its poster gave it, if any, or a link post's preview of the page it links to (see linkPreview). A slide of
// new Reddit's holds its picture three times: a blurred copy drawn behind it, the picture shown, and the full-size one
// its lightbox opens, which is the one kept.
function postPictures(post) {
  const url = postHref(post)
  if (url && isPicture(url)) {
    return [`![](${url.href})`]
  }
  if (postLinks(post).length) {
    const preview = post.matches('shreddit-post') && linkPreview(post)
    return preview ? [preview] : []
  }
  const gallery = post.matches('shreddit-post')
    ? post.querySelectorAll('gallery-carousel img:not([class*="background"])')
    : post.querySelectorAll('.media-gallery img, .gallery-tile img')
  const title = post.getAttribute('post-title')
  const blocks = []
  for (const img of gallery) {
    const fullSize = img.closest('li')?.querySelector('.lightboxed-content img')
    const block = !fullSize || fullSize === img ? imageBlock(img, galleryCaption(img, title)) : null
    if (block && !blocks.includes(block)) {
      blocks.push(block)
    }
  }
  return blocks
}

// The blocks of a rendered Markdown body, however deeply its wrappers nest them: each paragraph, list item, code block
// or heading, a list item's own paragraphs counting as part of it.
function markdownBlocks(body) {
  if (!body) {
    return []
  }
  const selector = 'p, li, pre, h1, h2, h3, h4, h5, h6'
  const blocks = Array.from(body.querySelectorAll(selector))
    .filter(node => !node.parentElement.closest(selector))
    .map(node => node.innerText.trim())
    .filter(Boolean)
  const text = body.innerText.trim()
  return blocks.length || !text ? blocks : [text]
}

// The comments a comment is a reply to, however deeply: as many as its depth.
function ancestorCount(comment, selector) {
  let count = 0
  for (let parent = comment.parentElement?.closest(selector); parent; parent = parent.parentElement?.closest(selector)) {
    count++
  }
  return count
}

// A comment's own element of those selector finds in it, however deeply its markup nests it, but not a reply's.
function ownElement(comment, selector, commentSelector) {
  return Array.from(comment.querySelectorAll(selector)).find(element => element.closest(commentSelector) === comment)
}

// A user's page, as the site links it (old Reddit's on old Reddit); none for a deleted user.
function userUrl(author) {
  return author && author !== '[deleted]' ? new URL(`/user/${encodeURIComponent(author)}/`, location.origin).href : undefined
}

// The authors of these posts, once each, as postBlock takes them, leaving out those of deleted posts.
function postAuthors(posts) {
  const names = new Set(posts.map(post => post.getAttribute('author') ?? post.getAttribute('data-author')))
  return Array.from(names, name => ({ name, url: userUrl(name) })).filter(author => author.url)
}

// The subreddit a post is posted to: its subreddit-name (modern) or data-subreddit (old Reddit), else the one its
// permalink is under. None for a post to a user's profile (u_<name>), whose page the post already links to.
function postSubreddit(post) {
  const name = post.getAttribute('subreddit-name') || post.getAttribute('data-subreddit')
    || /^\/r\/([^/]+)/.exec(post.getAttribute('permalink') || post.getAttribute('data-permalink') || '')?.[1]
  return name && !name.startsWith('u_') ? name : undefined
}

// A post page links to the subreddits of these posts (a crosspost's and its original's), once each, with weight 1, so
// a search reaches what else is posted there.
function subredditLinks(posts) {
  const names = new Map()
  for (const name of posts.map(postSubreddit).filter(Boolean)) {
    names.set(name.toLowerCase(), names.get(name.toLowerCase()) ?? name)
  }
  return Array.from(names.values(), name => ({ url: new URL(`/r/${name}/`, location.origin).href, score: 1 }))
}

// A post's own text, modern or old Reddit.
function postText(post) {
  return markdownBlocks(post.querySelector('[slot="text-body"], .usertext-body'))
}

// A post's head (see postBlock): its title, the page it links to (url), if any, its authors (a crosspost's poster and
// the original's), its score and when it was posted, modern (score, created-timestamp) or old Reddit (data-score, its
// tagline's time). A post page's content begins with it, so its title heads the page read.
function postHead(post, title, url, authors) {
  const modern = post.matches('shreddit-post')
  const score = post.getAttribute(modern ? 'score' : 'data-score')
  return postBlock({
    title,
    url,
    authors,
    score: score == null || score === '' ? null : Number(score),
    time: isoTime(modern ? post.getAttribute('created-timestamp') : post.querySelector('.tagline time[datetime]')?.getAttribute('datetime')),
  })
}

// A modern comment's head (see commentBlock) and text: its [slot="comment"]. Its depth is its depth attribute, else
// the comments it is in, as a comments partial fetched for it holds the whole thread.
function modernComment(comment, op) {
  const author = comment.getAttribute('author') || '[deleted]'
  const time = ownElement(comment, 'faceplate-timeago[ts], time[datetime]', 'shreddit-comment')
  const permalink = comment.getAttribute('permalink')
  return [commentBlock({
    depth: comment.hasAttribute('depth') ? Number(comment.getAttribute('depth')) : ancestorCount(comment, 'shreddit-comment'),
    author,
    authorUrl: userUrl(author),
    score: comment.hasAttribute('score') ? Number(comment.getAttribute('score')) : null,
    time: isoTime(comment.getAttribute('created') || time?.getAttribute('ts') || time?.getAttribute('datetime')),
    url: permalink && new URL(permalink, location.origin).href,
    op: author !== '[deleted]' && author === op,
  }), ...markdownBlocks(ownElement(comment, '[slot="comment"]', 'shreddit-comment'))]
}

// An old Reddit comment's head (see commentBlock) and text. Its score is the number its tagline's score holds in its
// title ("12 points" in its text), none where the subreddit hides scores for a while.
function oldComment(comment, op) {
  const entry = comment.querySelector(':scope > .entry')
  const author = comment.getAttribute('data-author') || entry?.querySelector('.author')?.textContent.trim() || '[deleted]'
  const score = entry?.querySelector('.tagline .score.unvoted')
  const permalink = comment.getAttribute('data-permalink')
  return [commentBlock({
    depth: ancestorCount(comment, '.thing.comment'),
    author,
    authorUrl: userUrl(author),
    score: score ? Number.parseInt(score.getAttribute('title') || score.textContent, 10) : null,
    time: isoTime(entry?.querySelector('.tagline time[datetime]')?.getAttribute('datetime')),
    url: permalink && new URL(permalink, location.origin).href,
    op: author !== '[deleted]' && author === op,
  }), ...markdownBlocks(entry?.querySelector('.usertext-body'))]
}

// A post page's title and content: the post's video or pictures and own text, then each comment in page order, which
// is the thread's, each reply after the comment it replies to, modern or old Reddit. A deleted comment keeps its
// place, as its replies are under it. comments are a modern post's, if they are not in the page (see loadComments);
// video is the post's video block, if any (see postVideo); shown is the post whose video or pictures and text it
// shows besides its own text, the original of a crosspost (see originalPost).
function postContent(comments = document.querySelectorAll('shreddit-comment'), video = null, shown = pagePost()) {
  const post = document.querySelector('shreddit-post')
  const texts = [...new Set([pagePost(), shown])].filter(Boolean).flatMap(postText)
  if (post) {
    const content = [...(video ? [video] : postPictures(shown)), ...texts]
    for (const comment of comments) {
      content.push(...modernComment(comment, post.getAttribute('author')))
    }
    return { title: post.getAttribute('post-title'), content }
  }
  const thing = document.querySelector('#siteTable > .thing.link')
  if (!thing) {
    return null
  }
  const content = [...(video ? [video] : postPictures(shown)), ...texts]
  for (const comment of document.querySelectorAll('.commentarea .thing.comment')) {
    content.push(...oldComment(comment, thing.getAttribute('data-author')))
  }
  return { title: thing.querySelector('a.title')?.textContent.trim(), content }
}

// How many comments a post page says its post has (modern Reddit's comment-count, old Reddit's data-comments-count),
// or null if it does not say.
function commentCount() {
  const count = document.querySelector('shreddit-post')?.getAttribute('comment-count')
    ?? document.querySelector('#siteTable > .thing.link')?.getAttribute('data-comments-count')
  return count == null || count === '' ? null : Number(count)
}

// The comments of a modern post page. Reddit sends the page without them, and its post-detail-modules partial loads
// them, which a scrape's background tab may not do in time; so if none have appeared, the partial is fetched as the
// page would fetch it, and, should it hold no comments itself, a comments partial in it.
async function loadComments() {
  const loaded = document.querySelectorAll('shreddit-comment')
  let partial = document.querySelector('faceplate-partial[src*="/post-detail-modules/"]')
  for (let depth = 0; loaded.length === 0 && partial && depth < 2; depth++) {
    try {
      const response = await pageFetch(new URL(partial.getAttribute('src'), location.origin).href)
      if (!response.ok) {
        break
      }
      const page = new DOMParser().parseFromString(await response.text(), 'text/html')
      const comments = page.querySelectorAll('shreddit-comment')
      if (comments.length) {
        return Array.from(comments)
      }
      partial = page.querySelector('faceplate-partial[src*="comments"]')
    } catch {
      break
    }
  }
  return Array.from(loaded)
}

// A post's id, if url is a post's page.
function postId(url) {
  return /\/comments\/([^/]+)/.exec(url.pathname)?.[1]
}

// The post a post shows: its original, if it is a crosspost, which links to the original's page (on the site being
// read, for an absolute link to the other one could not be fetched) and holds none of its text, only a card that the
// page draws. A crosspost of a crosspost is followed to the first. Otherwise, or if the page cannot be fetched or read,
// the post itself, the card's player or embed still giving its video. pageUrl is the page post was read from.
async function originalPost(post, pageUrl = location) {
  const url = postHref(post)
  if (!url?.hostname.endsWith('reddit.com') || !postId(url) || postId(url) === postId(pageUrl)) {
    return post
  }
  try {
    const original = new URL(url.pathname, location.origin)
    const response = await pageFetch(original.href)
    const found = response.ok && pagePost(new DOMParser().parseFromString(await response.text(), 'text/html'))
    return found ? await originalPost(found, original) : post
  } catch {
    return post
  }
}

// A video hosted by Reddit, as a content block: its HLS playlist, which pairs each size of the video with its sound
// (they are separate files) and, unlike the player's own playlist and mp4s, needs no signature that expires, with the
// player's poster frame. Its id is the post's link (https://v.redd.it/<id>), or, for a crosspost whose original cannot
// be fetched, its player's.
function redditVideo(post) {
  const url = postHref(post)
  const player = post.querySelector('shreddit-player, shreddit-player-2')
  const src = url?.hostname === 'v.redd.it' ? url : player?.getAttribute('src') && new URL(player.getAttribute('src'))
  const id = src?.hostname === 'v.redd.it' && /^\/([^/]+)/.exec(src.pathname)?.[1]
  return id ? videoBlock(`https://v.redd.it/${id}/HLSPlaylist.m3u8`, player?.getAttribute('poster') || '') : null
}

// A YouTube video's id, from any of the links to it: youtube.com/watch?v=<id>, youtu.be/<id>, or its page as a short,
// a live stream or an embed (/shorts/<id>, /live/<id>, /embed/<id>), on www., m. or youtube-nocookie.com.
function youtubeId(url) {
  const host = url.hostname.replace(/^(?:www|m)\./, '')
  const id = host === 'youtu.be'
    ? url.pathname.slice(1)
    : host === 'youtube.com' || host === 'youtube-nocookie.com'
      ? url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([^/]+)/.exec(url.pathname)?.[1]
      : null
  return id && /^[\w-]{11}$/.test(id) ? id : null
}

// A YouTube video embedded in a post, as a content block: its watch page, which the reader plays in YouTube's own
// player, with its poster frame. Its id is the post's link, or, for a crosspost whose original cannot be fetched, its
// embed's (shreddit-embed, which holds its player's <iframe> as HTML).
function youtubeVideo(post) {
  const url = postHref(post)
  const embed = post.querySelector('shreddit-embed[html*="youtube"]')
  const id = (url && youtubeId(url)) || /youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/.exec(embed?.getAttribute('html') || '')?.[1]
  return id ? videoBlock(`https://www.youtube.com/watch?v=${id}`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`) : null
}

// A post's video, as a content block (see videoBlock): a video hosted by Reddit (see redditVideo) or YouTube (see
// youtubeVideo), or a RedGIFs GIF's, which the GIF's watch page names in its metadata (video.contentUrl, its silent
// copy, so the one with sound is taken instead, as the reader plays it), with its poster frame. None for any other
// post. RedGIFs lets no other site read its watch pages, so the extension's background fetches it (see fetchText).
async function postVideo(post) {
  const known = redditVideo(post) || youtubeVideo(post)
  if (known) {
    return known
  }
  const url = postHref(post)
  const id = url?.hostname.endsWith('redgifs.com') && /^\/(?:watch|ifr)\/([^/]+)/.exec(url.pathname)?.[1]
  if (!id) {
    return null
  }
  try {
    const html = await fetchText(`https://www.redgifs.com/watch/${id.toLowerCase()}`)
    if (!html) {
      return null
    }
    const page = new DOMParser().parseFromString(html, 'text/html')
    const video = JSON.parse(page.querySelector('script[type="application/ld+json"]')?.textContent || 'null')?.video
    return video?.contentUrl ? videoBlock(video.contentUrl.replace(/-silent\.mp4$/, '.mp4'), video.thumbnailUrl) : null
  } catch {
    return null
  }
}

// A search's page of results (/search/?q=…, or a subreddit's, /r/rust/search/?q=…) is read as a listing of the posts
// it found (see searchResultsOf), in its order, each as its comments page, titled by its link: a result's title link
// (a[data-testid="post-title"], old Reddit's a.search-title), or any link to a post's comments, which a comment found
// stands for. The results can take a while to appear, so they are waited for.
async function parseRedditSearch() {
  const links = 'a[data-testid="post-title"], a.search-title, a[href*="/comments/"]'
  await waitFor(() => document.querySelector(links), 10000)
  const results = Array.from(document.querySelectorAll(links), (a) => {
    const post = /^\/(?:r|user)\/[^/]+\/comments\/[^/]+\/(?:[^/]+\/)?/.exec(new URL(a.href).pathname)?.[0]
    return { url: post && `${location.origin}${post}`, title: a.textContent }
  })
  return searchResultsOf('Reddit', results)
}

async function parseReddit() {
  if (!location.hostname.includes('reddit.com')) {
    return null
  }
  // Scroll to trigger lazy loading
  window.scrollTo(0, 500)
  window.scrollTo(0, 0)
  if (/^(?:\/r\/[^/]+)?\/search\/?$/.test(location.pathname)) {
    return parseRedditSearch()
  }
  // A listing's posts can take a while to appear in a scrape's background tab, so they are waited for rather than
  // read after a fixed delay.
  if (isListing(location.pathname)) {
    await waitFor(() => document.querySelector('shreddit-post, shreddit-profile-comment, #siteTable > .thing.link, #siteTable > .thing.comment'), 10000)
    // Empty content, as none would leave the page's menus and post cards to the default parse.
    return { links: listingLinks(await loadListedPosts()), listing: true, content: [] }
  }
  if (!location.pathname.includes('/comments/')) {
    return null
  }
  // A scrape has 15 s in all, the page's loading included, so the post is waited for rather than a fixed delay, and
  // its comments only if it has any, and not for long, as a modern page's can be fetched instead.
  await waitFor(() => document.querySelector('shreddit-post, #siteTable > .thing.link'), 5000)
  if (commentCount() !== 0) {
    await waitFor(() => document.querySelector('shreddit-comment, .commentarea .thing.comment'), 2000)
  }
  const post = pagePost()
  if (!post) {
    return null
  }
  const original = originalPost(post)
  const [comments, shown, video] = await Promise.all([
    post.matches('shreddit-post') && commentCount() !== 0 ? loadComments() : document.querySelectorAll('shreddit-comment'),
    original,
    original.then(postVideo),
  ])
  const links = postLinks(shown)
  const parsed = postContent(comments, video, shown)
  const authors = postAuthors([post, shown])
  return {
    ...parsed,
    content: [postHead(post, parsed.title, links[0]?.url, authors), ...parsed.content],
    links: [...links, ...authorLinks(authors), ...subredditLinks([post, shown])],
    ...(links.length && { discussionOf: links[0].url }),
  }
}

// The parser a scrape calls.
registerParser(parseReddit)
