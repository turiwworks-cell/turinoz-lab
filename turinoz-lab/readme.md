# TURINOZ / LAB

A static home for interactive Rive and motion experiments. Plain HTML, CSS and
JavaScript; no build step.

```
index.html              the index page
404.html                shown for any missing address
netlify.toml            headers and caching
sphere/                 Interactive Sphere (its own page, runtime and .riv)
spectra/                Spectra (its own page, runtime and .riv)
eye-planet/             Interactive Eye & Planet Icons (its own page, runtime, fonts and two .riv files)
assets/
  js/projects.js        ← the list on the index page
  js/lab.js             builds the list, cursor, magnetic links, entrance
  css/lab.css           styles
  fonts/                Mona Sans (variable, SIL Open Font License)
  img/                  favicon, touch icon, social image
```

## Deploying to Netlify

Drag the whole `turinoz-lab` folder onto https://app.netlify.com/drop, or
connect it as a repo with no build command and the root as the publish
directory (already set in `netlify.toml`).

The social tags assume the address `https://lab.turinoz.co`. If you use a
different domain, update `og:url` and `og:image` in `index.html`.

## Adding an experiment

1. Put its files in a new folder at the root, e.g. `orbit/` with its own
   `index.html`. Keep paths inside it relative (`vendor/rive.js`, not
   `/vendor/rive.js`).
2. Add a line to `projects` in `assets/js/projects.js`:
   `{ slug: 'orbit', title: 'Orbit', category: 'Motion study', year: 2026 }`

Numbers (01, 02…) are added automatically in list order.

## Previewing locally

The experiments can't load their `.riv` files from a page opened by
double-clicking, so run a local server from this folder:

```
python -m http.server 8000
```

then open http://localhost:8000.

## Notes

- The custom cursor and magnetic links only run with a mouse or trackpad, and
  are off when the visitor has reduced motion turned on.
- `sphere/` and `spectra/` are your builds as supplied. Only the local-run
  helpers (Start.cmd, start.py, readme) and `spectra.lua` were left out, since
  the site doesn't use them.

- `sphere/` now holds the photo sphere (usePhotos). Pages opened by double-clicking use `sphere/vendor/file-mode.js`, which is only fetched in that case and can be deleted for a hosted-only site.

- `eye-planet/` is index-6 with the recording panel and its shortcuts removed. The Rive
  runtime, fonts and the two .riv files (eye_icon.riv, planet_icon.riv) are served from
  the folder itself, so the page makes no CDN or Google Fonts requests.
