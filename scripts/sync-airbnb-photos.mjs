#!/usr/bin/env node

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const propertiesDir = path.join(root, "properties");
const assetsDir = path.join(root, "assets", "properties");
const propertySlugs = [
  "beachfront-bliss",
  "deep-blue-dive",
  "sea-turtle",
  "seaside-vibes",
  "stars-and-sea",
  "the-salty-dog",
  "waterfront-paradise",
];

const userAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function findPhotoTour(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  if (
    value.__typename === "PhotoTourModalSection" &&
    Array.isArray(value.mediaItems)
  ) {
    return value.mediaItems;
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const result = findPhotoTour(child, seen);
    if (result) return result;
  }
  return null;
}

function collectVisiblePhotos(value, photos = [], seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return photos;
  seen.add(value);

  if (value.__typename === "HeroImageItem" && value.image?.uri) {
    photos.push(value.image.uri);
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) collectVisiblePhotos(child, photos, seen);
  return photos;
}

function extractPhotoTour(html) {
  const scripts = html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    const source = match[1];
    if (!source.includes("PhotoTourModalSection")) continue;
    try {
      const mediaItems = findPhotoTour(JSON.parse(source));
      if (mediaItems?.length) {
        return mediaItems.filter((item) => item?.baseUrl);
      }
    } catch {
      // Airbnb includes many non-JSON script tags. Continue to the next script.
    }
  }
  throw new Error("Airbnb photo manifest was not found");
}

function extractVisiblePhotoOrder(html) {
  const scripts = html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi);
  let best = [];
  for (const match of scripts) {
    const source = match[1];
    if (!source.includes("HeroImageItem")) continue;
    try {
      const ordered = collectVisiblePhotos(JSON.parse(source));
      const unique = [...new Set(ordered)];
      if (unique.length > best.length) best = unique;
    } catch {
      // Continue to the next JSON script.
    }
  }
  return best;
}

function extensionFor(url) {
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".webp"].includes(extension)
    ? extension
    : ".jpg";
}

async function fetchWithRetry(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "user-agent": userAgent } });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function syncProperty(slug) {
  const propertyPath = path.join(propertiesDir, `${slug}.json`);
  const property = JSON.parse(await readFile(propertyPath, "utf8"));
  if (!property.airbnb) throw new Error(`${slug}: Airbnb URL is missing`);

  const listingUrl = new URL(property.airbnb);
  listingUrl.searchParams.set("modal", "PHOTO_TOUR_SCROLLABLE");
  const page = await fetchWithRetry(listingUrl);
  const html = await page.text();
  const photoTour = extractPhotoTour(html);
  const visibleOrder = extractVisiblePhotoOrder(html);
  const photoById = new Map(
    photoTour.map((item) => [path.basename(new URL(item.baseUrl).pathname), item])
  );
  const visibleItems = visibleOrder
    .map((url) => photoById.get(path.basename(new URL(url).pathname)))
    .filter(Boolean);
  const mediaItems =
    visibleItems.length === photoTour.length ? visibleItems : photoTour;
  const targetDir = path.join(assetsDir, slug);
  await mkdir(targetDir, { recursive: true });

  const oldFiles = await readdir(targetDir);
  await Promise.all(
    oldFiles
      .filter((name) => /^\d+\.(?:jpe?g|png|webp)$/i.test(name))
      .map((name) => rm(path.join(targetDir, name)))
  );

  const width = String(mediaItems.length).length;
  const gallery = await mapWithConcurrency(mediaItems, 8, async (item, index) => {
    const extension = extensionFor(item.baseUrl);
    const filename = `${String(index + 1).padStart(width, "0")}${extension}`;
    const imageUrl = new URL(item.baseUrl);
    imageUrl.searchParams.set("im_w", "1440");
    imageUrl.searchParams.set("im_q", "medq");
    const response = await fetchWithRetry(imageUrl);
    await writeFile(path.join(targetDir, filename), Buffer.from(await response.arrayBuffer()));
    return `/assets/properties/${slug}/${filename}`;
  });

  property.image = gallery[0];
  property.gallery = gallery;
  delete property.photoOrder;
  await writeFile(propertyPath, `${JSON.stringify(property, null, 2)}\n`);
  console.log(`${slug}: ${gallery.length} photos synchronized`);
}

for (const slug of propertySlugs) {
  await syncProperty(slug);
}
