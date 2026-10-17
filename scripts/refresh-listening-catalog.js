// Rebuilds resources/external/lazybenkyou_videos.json from YouTube's public RSS feed
// and oEmbed endpoint (the official, lightweight way to list a channel's recent videos).
// Nothing is downloaded or re-hosted; only titles, ids, dates and thumbnail URLs are kept.
// Usage: node scripts/refresh-listening-catalog.js
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CHANNEL_HANDLE_URL = 'https://www.youtube.com/@LazyBenkyou';
const CHANNEL_ID = 'UCzMTW1vcB1IoPC5GzD0wqoQ'; // read from the channel page's RSS link
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'external', 'lazybenkyou_videos.json');

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

// Topic keywords are matched against the video *title* only, so each topic has visible evidence.
const TOPICS = [
  [/caf[eé]|order/i, 'food'], [/time/i, 'time'], [/shopping|money/i, 'shopping'],
  [/doctor|sick/i, 'health'], [/train|direction/i, 'directions'], [/reservation/i, 'places'],
  [/cook/i, 'food'], [/walk|neighborhood/i, 'places'],
];

export function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const title = decode(/<title>([\s\S]*?)<\/title>/.exec(e)[1]);
    const videoId = /<yt:videoId>(.*?)<\/yt:videoId>/.exec(e)[1];
    const published = /<published>(.*?)<\/published>/.exec(e)[1].slice(0, 10);
    const level = /JLPT\s*N([1-5])/i.exec(title);
    const ep = /^EP\s*(\d+)/i.exec(title);
    const topics = [...new Set(TOPICS.filter(([re]) => re.test(title)).map(([, t]) => t))];
    return {
      videoId, title, published,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      series: ep ? 'Listening episodes' : 'Situational listening practice',
      episode: ep ? Number(ep[1]) : null,
      difficulty: level ? `N${level[1]}` : 'unknown',
      difficultyEvidence: level ? 'Stated in the video title' : 'No level stated in title',
      topics, transcript: null, transcriptNote: 'No legitimate transcript is bundled; none is invented.',
    };
  });
}

async function embeddable(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${videoId}`, { signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch { return null; } // null = could not verify
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = await fetch(FEED, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'NihongoGraph-catalog/1.0' } });
  if (!res.ok) throw new Error(`Feed returned ${res.status}`);
  const videos = parseFeed(await res.text());
  for (const v of videos) { v.embeddable = await embeddable(v.videoId); await new Promise((r) => setTimeout(r, 250)); }
  const catalog = {
    source: { name: 'Lazy Benkyou', website: 'https://lazybenkyou.com/', startPage: 'https://lazybenkyou.com/start', youtubeChannel: CHANNEL_HANDLE_URL, channelId: CHANNEL_ID, feed: FEED },
    license: 'Content © Lazy Benkyou Studios LLC. Only metadata and links are stored; videos are embedded via YouTube and never downloaded or redistributed.',
    verifiedAt: new Date().toISOString(),
    verification: 'Video ids/titles/dates read from the channel\'s public YouTube RSS feed; embeddable = YouTube oEmbed returned HTTP 200.',
    videos,
  };
  await writeFile(OUT, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Wrote ${videos.length} videos to ${OUT}`);
}
