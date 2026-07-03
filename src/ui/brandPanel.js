// ---------------------------------------------------------------------------
// Brand CMS panel (brands.html).
//
// A dedicated management space for brand-defining inputs — palette, logos,
// imagery, principles/rules and motion language — for IQOS, ZYN and VEEV. It is
// isolated from the live DJ booth (separate route) but stays connected to output
// generation: edits persist + sync via the bus, and "Apply palette to current
// artwork" pushes a brand look into the live piece through the existing
// SET_ART_PARAM command. The model lives in core/brands.js.
// ---------------------------------------------------------------------------

import { CommandTypes, makeCommand } from '../core/events.js';
import { listBrands, getBrand, brandColorParams } from '../core/brands.js';
import { el, section } from './dom.js';

export function initBrandPanel({ root, state, dispatch }) {
  const brandBtns = new Map();

  // Always read the brand fresh from state inside handlers — successive edits
  // must not spread a stale snapshot (which would revert earlier changes).
  const active = () => getBrand(state.brands, state.activeBrandId);
  const patchBrand = (patch) =>
    dispatch(makeCommand(CommandTypes.SET_BRAND, { brandId: state.activeBrandId, patch }));

  // -- Brand selector ----------------------------------------------------
  const brandRow = el('div', { class: 'btn-grid' });
  for (const b of listBrands(state.brands)) {
    const btn = el('button', {
      class: 'opt',
      text: b.label,
      onclick: () => dispatch(makeCommand(CommandTypes.SET_ACTIVE_BRAND, { brandId: b.id })),
    });
    brandBtns.set(b.id, btn);
    brandRow.append(btn);
  }

  // -- Editor sections (rebuilt when the active brand changes) ------------
  const editor = el('div', { class: 'panel-grid' });

  function paletteSection(brand) {
    const swatchField = (label, key) => {
      const input = el('input', {
        type: 'color', class: 'color-input', value: brand.palette[key] || '#000000',
        oninput: (e) => patchBrand({ palette: { ...active().palette, [key]: e.target.value } }),
      });
      return el('label', { class: 'field' }, [el('span', { text: label }), input]);
    };
    const core = el('div', { class: 'field-row' }, [
      swatchField('Primary', 'primary'),
      swatchField('Secondary', 'secondary'),
      swatchField('Background', 'background'),
    ]);
    const accents = (brand.palette.accents || []).length
      ? el('div', { class: 'swatch-row' }, brand.palette.accents.map((c) =>
          el('span', { class: 'swatch swatch--lg', style: `background:${c}`, title: c })))
      : null;
    const apply = el('button', {
      class: 'opt opt--wide', text: 'Apply palette to current artwork',
      onclick: () => {
        for (const [key, value] of Object.entries(brandColorParams(active()))) {
          dispatch(makeCommand(CommandTypes.SET_ART_PARAM, { artId: state.artId, key, value }));
        }
      },
    });
    return section('Palette', el('div', { class: 'stack' }, [core, accents, apply]));
  }

  function assetList(items, emptyText) {
    if (!items || !items.length) return [el('p', { class: 'fx-note', text: emptyText })];
    return items.map((it) => el('div', { class: 'asset-row' }, [
      el('span', { class: 'asset-name', text: it.label }),
      it.kind ? el('span', { class: 'asset-kind', text: it.kind }) : null,
      it.src
        ? el('a', { class: 'asset-link', href: it.src, target: '_blank', rel: 'noopener', text: 'open ↗' })
        : (it.note ? el('span', { class: 'fx-note', text: it.note }) : null),
    ]));
  }

  function logosSection(brand) {
    return section('Logos', el('div', { class: 'stack' }, assetList(brand.logos, 'No logos yet.')));
  }
  function imagerySection(brand) {
    return section('Imagery', el('div', { class: 'stack' }, assetList(brand.imagery, 'No imagery yet.')));
  }

  function principlesSection(brand) {
    const ta = el('textarea', {
      class: 'brand-text', rows: '4', spellcheck: 'false',
      onchange: (e) => patchBrand({ principles: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }),
    });
    ta.value = (brand.principles || []).join('\n');
    return section('Brand principles / rules', el('div', { class: 'stack' }, [
      el('p', { class: 'fx-note', text: 'One rule per line — these guide palette, logo usage, motion and imagery.' }),
      ta,
    ]));
  }

  function motionSection(brand) {
    const input = el('input', {
      type: 'text', class: 'brand-input', value: brand.motion?.language || '',
      onchange: (e) => patchBrand({ motion: { ...active().motion, language: e.target.value } }),
    });
    return section('Motion language', el('label', { class: 'field' }, [el('span', { text: 'Feel' }), input]));
  }

  // -- Textures (for the realistic 3D piece) ------------------------------
  // Multiple uploads per category; images are downscaled to ≤512px data-URLs so
  // they persist in localStorage and sync over the bus like everything else.
  const MAX_TEX = 8;
  const readAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
  const downscale = (file, max = 512, fill = null) => readAsDataUrl(file).then((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      const ctx = c.getContext('2d');
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(0, 0, c.width, c.height); } // flatten alpha
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.src = src;
  }));

  function texGroup(label, cat, brand) {
    const items = brand.textures?.[cat] || [];
    const grid = el('div', { class: 'tex-grid' }, [
      ...items.map((t) => el('div', { class: 'tex-thumb', title: t.name }, [
        el('img', { src: t.src, alt: t.name }),
        el('button', {
          class: 'tex-del', type: 'button', 'aria-label': `Remove ${t.name}`, text: '×',
          onclick: () => {
            const cur = active().textures || {};
            patchBrand({ textures: { ...cur, [cat]: (cur[cat] || []).filter((x) => x.id !== t.id) } });
            rebuildEditor();
          },
        }),
      ])),
    ]);
    const input = el('input', {
      type: 'file', accept: 'image/*', multiple: '', class: 'tex-input',
      onchange: async (e) => {
        const files = [...e.target.files].slice(0, MAX_TEX);
        const added = [];
        for (const f of files) {
          try { added.push({ id: `${Date.now()}-${added.length}`, name: f.name, src: await downscale(f) }); }
          catch { /* unreadable file — skip */ }
        }
        if (added.length) {
          const cur = active().textures || {};
          patchBrand({ textures: { ...cur, [cat]: [...(cur[cat] || []), ...added].slice(0, MAX_TEX) } });
          rebuildEditor();
        }
        e.target.value = '';
      },
    });
    return el('div', { class: 'stack' }, [
      el('span', { class: 'fx-note', text: `${label} — up to ${MAX_TEX}; applied to the Vitrine art's ${cat}` }),
      grid,
      input,
    ]);
  }

  function texturesSection(brand) {
    return section('Textures', el('div', { class: 'stack' }, [
      texGroup('Cube textures', 'cubes', brand),
      texGroup('Sphere textures', 'spheres', brand),
    ]));
  }

  // -- Background image (behind brand-themed arts) -------------------------
  // One per brand. SVGs are stored AS-IS (vector — stays sharp at any display
  // size and its true colours are preserved on screen); raster images are
  // capped to ≤1600px, flattened onto the brand background colour.
  function backgroundSection(brand) {
    const stack = el('div', { class: 'stack' }, [
      el('p', {
        class: 'fx-note',
        text: 'Shown behind brand-themed artworks (Key Particles) in the brand’s true colours. SVG recommended — stored as vector.',
      }),
    ]);
    if (brand.bgImage) {
      stack.append(
        el('div', { class: 'bg-preview' }, [el('img', { src: brand.bgImage, alt: `${brand.label} background` })]),
        el('button', {
          class: 'opt', text: 'Remove background',
          onclick: () => { patchBrand({ bgImage: null }); rebuildEditor(); },
        }),
      );
    }
    stack.append(el('input', {
      type: 'file', accept: 'image/svg+xml,image/*', class: 'tex-input',
      onchange: async (e) => {
        const f = e.target.files[0];
        if (f) {
          try {
            const src = f.type === 'image/svg+xml'
              ? await readAsDataUrl(f)
              : await downscale(f, 1600, active().palette.background || '#000');
            patchBrand({ bgImage: src });
            rebuildEditor();
          } catch { /* unreadable file — keep the current background */ }
        }
        e.target.value = '';
      },
    }));
    return section('Background', stack);
  }

  let lastBrandId = null;
  function rebuildEditor() {
    const brand = active();
    editor.replaceChildren(
      paletteSection(brand),
      backgroundSection(brand),
      logosSection(brand),
      texturesSection(brand),
      imagerySection(brand),
      principlesSection(brand),
      motionSection(brand),
    );
  }
  function refresh() {
    for (const [id, btn] of brandBtns) btn.classList.toggle('active', id === state.activeBrandId);
    if (state.activeBrandId !== lastBrandId) {
      lastBrandId = state.activeBrandId;
      rebuildEditor(); // rebuild only on brand switch, so live edits don't clobber inputs
    }
  }

  // -- Assemble ----------------------------------------------------------
  root.append(
    el('header', { class: 'panel-header' }, [
      el('div', {}, [
        el('h1', { text: 'Brand CMS' }),
        el('p', { class: 'subtitle', text: 'Brand-defining inputs' }),
      ]),
      el('div', { class: 'header-links' }, [
        el('a', { class: 'display-link', href: './control.html', text: '← Control' }),
        el('a', { class: 'display-link', href: './index.html', target: '_blank', rel: 'noopener', text: 'Open display ↗' }),
      ]),
    ]),
    section('Brand', brandRow),
    editor,
  );

  refresh();
  return { refresh };
}
