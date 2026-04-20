import { readFileSync } from 'fs';
import { join } from 'path';
import {
  countPackageListContainers,
  detectTenantSlug,
  imageDedupKey,
  parsePackageBook,
  parsePackageList,
} from '../mediaslidePackageParser';

const FIXTURE_DIR = join(__dirname, 'fixtures');
const LIST_HTML = readFileSync(
  join(FIXTURE_DIR, 'mediaslide_package_hausofhay_list.html'),
  'utf-8',
);
const BOOK_HTML = readFileSync(
  join(FIXTURE_DIR, 'mediaslide_package_hausofhay_book674.html'),
  'utf-8',
);

describe('mediaslidePackageParser — real fixture (hausofhay / REMI)', () => {
  it('parsePackageList extracts exactly 1 model with stable identifiers', () => {
    const entries = parsePackageList(LIST_HTML);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.mediaSlideModelId).toBe('256');
    expect(e.packageModelId).toBe('1218');
    expect(e.defaultCategoryId).toBe('674');
    expect(e.name).toBe('RÉMI LOVISOLO');
    expect(e.coverImageUrl).toMatch(/profile-1776519990-/);
    expect(e.instagram).toBe('rem_lvs');
    expect(e.heightHintCm).toBe(187);
  });

  it('parsePackageBook extracts measurements + 5 portfolio images in DOM order', () => {
    const book = parsePackageBook(BOOK_HTML);
    expect(book.name).toBe('RÉMI LOVISOLO');
    expect(book.measurements.height).toBe(187);
    expect(book.measurements.chest).toBe(96);
    expect(book.measurements.waist).toBe(82);
    expect(book.measurements.hips).toBe(97);
    expect(book.measurements.legs_inseam).toBe(81);
    expect(book.measurements.shoe_size).toBe(45);
    expect(book.hair_color_raw).toBe('Dark brown');
    expect(book.eye_color_raw).toBe('Green brown');
    expect(book.albumCatalog).toEqual([
      { categoryId: '674', title: 'PORTFOLIO', count: 1 },
      { categoryId: '675', title: 'POLAROIDS', count: 1 },
    ]);
    expect(book.imagesForCurrentCategory).toHaveLength(5);
    expect(book.imagesForCurrentCategory[0]).toMatch(/large-1776519990-/);
    // Reihenfolge stabil: erstes Bild (eager src), danach lazy in DOM-Order.
    expect(book.imagesForCurrentCategory[1]).toMatch(/large-1776519981-/);
    expect(book.imagesForCurrentCategory[2]).toMatch(/large-1776519968-/);
  });

  it('detectTenantSlug returns "hausofhay"', () => {
    expect(detectTenantSlug(LIST_HTML)).toBe('hausofhay');
    expect(detectTenantSlug(BOOK_HTML)).toBe('hausofhay');
  });

  it('imageDedupKey is stable across cache-buster and size variants', () => {
    const a =
      'https://mediaslide-europe.storage.googleapis.com/hausofhay/pictures/256/674/large-1776519990-27ce7e7c63a1cfa5ddeb3706a702589b.jpg?v=1776520060';
    const b =
      'https://mediaslide-europe.storage.googleapis.com/hausofhay/pictures/256/674/profile-1776519990-27ce7e7c63a1cfa5ddeb3706a702589b.jpg';
    expect(imageDedupKey(a)).toBe(imageDedupKey(b));
  });
});

describe('mediaslidePackageParser — robustness', () => {
  it('falls back to height-hint when DOM lacks measurements', () => {
    const html = `
      <div id="packageModel_999" class="packageModel">
        <a href="#book-1"><img data-original="https://x/pictures/9/1/large-1-aaa.jpg" /></a>
        <div class="modelName" translate="no">JANE DOE</div>
        <a id="select_999" data-model-id="999"></a>
        <div class="modelHeight">175cm</div>
      </div>
    `;
    const entries = parsePackageList(html);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('JANE DOE');
    expect(entries[0].heightHintCm).toBe(175);
  });

  it('drops cards without data-model-id', () => {
    const html = `
      <div id="packageModel_1" class="packageModel">
        <div class="modelName" translate="no">No ID</div>
      </div>
      <div id="packageModel_2" class="packageModel">
        <div class="modelName" translate="no">Has ID</div>
        <a data-model-id="42" href="#book-7"></a>
      </div>
    `;
    const entries = parsePackageList(html);
    expect(entries).toHaveLength(1);
    expect(entries[0].mediaSlideModelId).toBe('42');
  });

  it('parses German-labelled measurements (synthetic)', () => {
    const html = `
      <div class="bookMenuName" translate="no">DE TEST</div>
      <div id="bookModelMeasurements">
        <div class="measurementElement"><span class="measurementTitle">Größe</span> <span class="measurementEu">180<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">Brust</span> <span class="measurementEu">95<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">Schuhe</span> <span class="measurementEu">44eu</span></div>
      </div>
    `;
    const book = parsePackageBook(html);
    expect(book.measurements.height).toBe(180);
    expect(book.measurements.chest).toBe(95);
    expect(book.measurements.shoe_size).toBe(44);
  });

  it('positional fallback only rescues HEIGHT, never routes other values to wrong fields', () => {
    // When MediaSlide rebrands every measurement label, the parser must NOT
    // guess that position #2 is "chest" — a female book would then have
    // bust→chest, waist→waist, hips→hips, but a male book would be inseam→hips.
    // Refusing to guess prevents a silent cross-field data corruption.
    const html = `
      <div id="bookModelMeasurements">
        <div class="measurementElement"><span class="measurementTitle">???</span> <span class="measurementEu">182<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">???</span> <span class="measurementEu">94<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">???</span> <span class="measurementEu">80<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">???</span> <span class="measurementEu">96<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">???</span> <span class="measurementEu">82<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">???</span> <span class="measurementEu">43eu</span></div>
      </div>
    `;
    const book = parsePackageBook(html);
    expect(book.measurements.height).toBe(182);
    // Crucially: no positional guess for chest/waist/hips/legs_inseam/shoe_size.
    expect(book.measurements.chest).toBeUndefined();
    expect(book.measurements.bust).toBeUndefined();
    expect(book.measurements.waist).toBeUndefined();
    expect(book.measurements.hips).toBeUndefined();
    expect(book.measurements.legs_inseam).toBeUndefined();
    expect(book.measurements.shoe_size).toBeUndefined();
  });

  it('positional fallback gives no HEIGHT when no cm element is present', () => {
    // Edge: label-less book with only shoe-size in EU should NOT smuggle the
    // shoe number into height.
    const html = `
      <div id="bookModelMeasurements">
        <div class="measurementElement"><span class="measurementTitle">???</span> <span class="measurementEu">43eu</span></div>
      </div>
    `;
    const book = parsePackageBook(html);
    expect(book.measurements.height).toBeUndefined();
    expect(book.measurements.shoe_size).toBeUndefined();
  });

  it('mixed-language measurements: english labels mapped exactly to fields (no swap)', () => {
    // Adversarial: Chest and Bust are easy to confuse; Hips and Hueften are alt spellings.
    const html = `
      <div id="bookModelMeasurements">
        <div class="measurementElement"><span class="measurementTitle">Height</span> <span class="measurementEu">187<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">Chest</span> <span class="measurementEu">96<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">Bust</span> <span class="measurementEu">89<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">Waist</span> <span class="measurementEu">75<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">Hueften</span> <span class="measurementEu">95<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">Inseam</span> <span class="measurementEu">81<span class="measurementUnit">cm</span></span></div>
        <div class="measurementElement"><span class="measurementTitle">Shoes</span> <span class="measurementEu">45eu</span></div>
        <div class="measurementElement"><span class="measurementTitle">Hair</span> Dark brown</div>
        <div class="measurementElement"><span class="measurementTitle">Eyes</span> Green brown</div>
      </div>
    `;
    const book = parsePackageBook(html);
    expect(book.measurements.height).toBe(187);
    expect(book.measurements.chest).toBe(96);
    expect(book.measurements.bust).toBe(89);
    expect(book.measurements.waist).toBe(75);
    expect(book.measurements.hips).toBe(95);
    expect(book.measurements.legs_inseam).toBe(81);
    expect(book.measurements.shoe_size).toBe(45);
    expect(book.hair_color_raw).toBe('Dark brown');
    expect(book.eye_color_raw).toBe('Green brown');
  });

  it('shoe size with US-only annotation does NOT silently land as cm', () => {
    // If MediaSlide ever omits the 'eu' annotation, we must NOT misinterpret.
    const html = `
      <div id="bookModelMeasurements">
        <div class="measurementElement"><span class="measurementTitle">Shoes</span> <span class="measurementEu">10us</span></div>
      </div>
    `;
    const book = parsePackageBook(html);
    expect(book.measurements.shoe_size).toBeFalsy();
  });

  it('placeholder/no-picture URLs are filtered out of book images', () => {
    const html = `
      <div class="modelBookPicture"><img class="portrait" src="https://static-ms-eu.mediaslide.com/images/no-picture.png" /></div>
      <div class="modelBookPicture"><img class="portrait" data-lazy="https://mediaslide-europe.storage.googleapis.com/x/pictures/1/1/large-1700000000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg" /></div>
    `;
    const book = parsePackageBook(html);
    expect(book.imagesForCurrentCategory).toHaveLength(1);
    expect(book.imagesForCurrentCategory[0]).toContain('large-1700000000');
  });

  it('extracts album catalog with multiple albums', () => {
    const html = `
      <div class="bookMenuLinks">
        <a href="#book-100"><span class="menuSelected">PORTFOLIO <span class="albumCounter">(12)</span></span></a>
        <a href="#book-101"><span class="menuUnselected">POLAROIDS <span class="albumCounter">(4)</span></span></a>
        <a href="#book-102"><span class="menuUnselected">DIGITALS <span class="albumCounter">(6)</span></span></a>
      </div>
    `;
    const book = parsePackageBook(html);
    expect(book.albumCatalog).toEqual([
      { categoryId: '100', title: 'PORTFOLIO', count: 12 },
      { categoryId: '101', title: 'POLAROIDS', count: 4 },
      { categoryId: '102', title: 'DIGITALS', count: 6 },
    ]);
  });

  it('countPackageListContainers counts EVERY packageModel container, even broken ones', () => {
    const html = `
      <div id="packageModel_1" class="packageModel"><div class="modelName">A</div></div>
      <div id="packageModel_2" class="packageModel">
        <div class="modelName">B</div>
        <a data-model-id="22"></a>
      </div>
      <div id="packageModel_3" class="packageModel"><!-- broken: no name --><a data-model-id="33"></a></div>
    `;
    expect(countPackageListContainers(html)).toBe(3);
    expect(parsePackageList(html).length).toBeLessThan(3);
  });

  it('countPackageListContainers returns 0 for empty / non-string input', () => {
    expect(countPackageListContainers('')).toBe(0);
    // @ts-expect-error intentional non-string
    expect(countPackageListContainers(null)).toBe(0);
    // @ts-expect-error intentional non-string
    expect(countPackageListContainers(undefined)).toBe(0);
  });

  it('multi-card list: parses every card', () => {
    const card = (id: number) => `
      <div id="packageModel_${id * 10}" class="packageModel">
        <a href="#book-${id}" ><img data-original="https://x/y/pictures/${id}/${id}/profile-1-${'a'.repeat(32)}.jpg" /></a>
        <div class="modelName" translate="no">Model ${id}</div>
        <a id="select_${id}" data-model-id="${id}"></a>
        <div class="modelHeight">17${id}cm</div>
      </div>
    `;
    const html = `${card(1)}${card(2)}${card(3)}`;
    const entries = parsePackageList(html);
    expect(entries.map((e) => e.mediaSlideModelId)).toEqual(['1', '2', '3']);
    expect(entries.map((e) => e.name)).toEqual(['Model 1', 'Model 2', 'Model 3']);
  });
});

describe('mediaslidePackageParser — drift smoke tests (synthetic broken fixtures)', () => {
  // Goal: ensure that when MediaSlide changes its HTML, the parser fails
  // PREDICTABLY (returns less / nothing) rather than silently producing garbage.
  // The drift detector then flags these via anchor coverage / extraction ratio.

  const goodCard = (id: number) => `
    <div id="packageModel_${id}" class="packageModel">
      <a href="#book-${id}"><img data-original="https://x/y/pictures/${id}/${id}/profile-1-${'a'.repeat(32)}.jpg" /></a>
      <div class="modelName" translate="no">Model ${id}</div>
      <a id="select_${id}" data-model-id="${id}"></a>
      <div class="modelHeight">17${id}cm</div>
    </div>
  `;

  it('renamed wrapper class → 0 cards detected, parsePackageList returns []', () => {
    const html = goodCard(1).replace('class="packageModel"', 'class="package_card_v2"');
    expect(countPackageListContainers(html)).toBe(0);
    expect(parsePackageList(html)).toHaveLength(0);
  });

  it('missing data-model-id on otherwise valid card → silently dropped', () => {
    const html = goodCard(1).replace(/data-model-id="\d+"/, '');
    // Container still detected (good for drift extractionRatio < 1)
    expect(countPackageListContainers(html)).toBe(1);
    expect(parsePackageList(html)).toHaveLength(0);
  });

  it('renamed modelName class → name lost, card dropped', () => {
    const html = goodCard(1).replace('class="modelName"', 'class="model_label"');
    expect(countPackageListContainers(html)).toBe(1);
    expect(parsePackageList(html)).toHaveLength(0);
  });

  it('mixed: 2 good cards + 2 broken cards → only 2 parsed but 4 detected', () => {
    const broken1 = goodCard(2).replace(/data-model-id="\d+"/, '');
    const broken2 = goodCard(4).replace('class="modelName"', 'class="other"');
    const html = goodCard(1) + broken1 + goodCard(3) + broken2;
    expect(countPackageListContainers(html)).toBe(4);
    const parsed = parsePackageList(html);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.mediaSlideModelId)).toEqual(['1', '3']);
  });

  it('empty album catalog → parsePackageBook still returns measurements without throwing', () => {
    const html = `
      <div class="bookMenuName" translate="no">EMPTY ALBUM MODEL</div>
      <div id="bookModelMeasurements">
        <div class="measurementElement"><span class="measurementTitle">Height</span> <span class="measurementEu">181<span class="measurementUnit">cm</span></span></div>
      </div>
    `;
    const book = parsePackageBook(html);
    expect(book.measurements.height).toBe(181);
    expect(book.albumCatalog).toEqual([]);
    expect(book.imagesForCurrentCategory).toEqual([]);
  });
});
