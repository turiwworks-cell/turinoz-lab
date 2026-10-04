/* ==========================================================================
   TURINOZ / LAB — content
   --------------------------------------------------------------------------
   The index on the home page is built from this list. Order in the list =
   order on the page; the numbers (01, 02…) are added automatically.

   ADDING AN EXPERIMENT
     1. Put the experiment's files in a new folder at the site root,
        e.g. /orbit/ with its own index.html.
     2. Add an entry below with slug: 'orbit'.
   To link somewhere else instead of a folder, add  href: 'https://…'.
   mobile: true sends phones to the folder's mobile/ version.
   ========================================================================== */

window.LAB = {
  site: {
    name: 'TURINOZ / LAB',
    studio: 'TURINOZ',
    studioUrl: 'https://turinoz.co',
    studioLabel: 'turinoz.co',
  },

  projects: [
    { slug: 'sphere', title: 'Interactive Sphere', category: 'Interaction study', year: 2026, mobile: true },
    { slug: 'spectra', title: 'Spectra', category: 'Color game', year: 2026, mobile: true },
    { slug: 'eye-planet', title: 'Interactive Eye & Planet Icons', category: 'Interactive icons', year: 2026 },
  ],
};

// Site root, worked out from this file's own location (assets/js/projects.js).
window.LAB.base = new URL('../../', document.currentScript.src).href;
