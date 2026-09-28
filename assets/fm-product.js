/**
 * FM — product page behaviour: the media gallery and the recently-viewed rail.
 *
 * Guarded on customElements.get, like the other FM elements, because more than
 * one section on the page can load this file.
 */

/* ----------------------------------------------------------------- gallery */

/*
 * The main image is a vertical scroller with one image per frame. A wheel
 * notch or a thumbnail click glides to the next image with an ease-in-out
 * curve; touch swipes use the browser's own snapping. Scrolling moves the
 * progress bar and highlights the matching thumbnail.
 */
if (!customElements.get('fm-gallery')) {
  const GLIDE_MS = 700;

  // Slow start, slow finish: the image eases out of view and the next eases in.
  const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  class FmGallery extends HTMLElement {
    connectedCallback() {
      if (this.bound) return;

      this.track = this.querySelector('[data-fm-track]');
      this.slides = Array.from(this.querySelectorAll('[data-fm-slide]'));
      this.bar = this.querySelector('[data-fm-progress]');
      this.thumbList = this.querySelector('[data-fm-thumbs]');
      this.thumbs = Array.from(this.querySelectorAll('[data-fm-thumb]'));
      if (!this.track || this.slides.length < 2) return;

      this.bound = true;
      this.current = 0;
      this.frame = null;
      this.glide = null;

      this.thumbs.forEach((thumb, index) => {
        thumb.addEventListener('click', () => this.show(index));
      });

      this.track.addEventListener('scroll', () => this.schedule(), { passive: true });
      this.track.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });

      // A finger on the images takes over from any glide in progress.
      this.track.addEventListener('touchstart', () => this.stopGlide(), { passive: true });

      // The frame height follows the column width, so recompute on resize.
      if ('ResizeObserver' in window) {
        new ResizeObserver(() => this.schedule()).observe(this.track);
      }

      this.update();
    }

    schedule() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.update();
      });
    }

    update() {
      const { scrollTop, scrollHeight, clientHeight } = this.track;
      if (!scrollHeight || !clientHeight) return;

      // Bar length is one frame's share of the whole strip; it travels the
      // strip's full height as the images scroll.
      if (this.bar) {
        const size = clientHeight / scrollHeight;
        const offset = scrollTop / clientHeight;
        this.bar.style.setProperty('--fm-progress-size', `${size * 100}%`);
        this.bar.style.setProperty('--fm-progress-offset', `${offset * 100}%`);
      }

      // During a glide the destination's thumbnail is already lit; don't
      // flick through every image on the way.
      if (this.glide) return;

      const index = Math.min(this.slides.length - 1, Math.max(0, Math.round(scrollTop / clientHeight)));
      if (index !== this.current) this.setCurrent(index);
    }

    /**
     * One wheel gesture moves exactly one image. A trackpad swipe fires a long
     * burst of wheel events with momentum, so further events are swallowed
     * until the glide has finished and the wheel has been quiet for a moment.
     * On the first or last image the wheel is left alone and the page scrolls
     * on as normal.
     */
    onWheel(event) {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

      const busy = Boolean(this.glide) || this.wheelLocked;
      const next = this.current + Math.sign(event.deltaY);
      if (!busy && (next < 0 || next >= this.slides.length)) return;

      event.preventDefault();

      this.wheelLocked = true;
      clearTimeout(this.wheelTimer);
      this.wheelTimer = setTimeout(() => {
        this.wheelLocked = false;
      }, 200);

      if (busy || next < 0 || next >= this.slides.length) return;
      this.show(next);
    }

    show(index) {
      const slide = this.slides[index];
      if (!slide) return;

      this.setCurrent(index);
      this.glideTo(slide.offsetTop);
    }

    glideTo(top) {
      this.stopGlide();

      const start = this.track.scrollTop;
      const distance = top - start;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!distance || reduceMotion) {
        this.track.scrollTop = top;
        return;
      }

      // Snapping would pull against the animation, so pause it for the glide.
      this.track.classList.add('is-gliding');
      const began = performance.now();

      const step = (now) => {
        const progress = Math.min(1, (now - began) / GLIDE_MS);
        this.track.scrollTop = start + distance * easeInOutCubic(progress);
        if (progress < 1) {
          this.glide = requestAnimationFrame(step);
        } else {
          this.stopGlide();
        }
      };
      this.glide = requestAnimationFrame(step);
    }

    stopGlide() {
      if (!this.glide) return;
      cancelAnimationFrame(this.glide);
      this.glide = null;
      this.track.classList.remove('is-gliding');
      this.schedule();
    }

    setCurrent(index) {
      this.current = index;
      this.thumbs.forEach((t, i) => t.setAttribute('aria-current', i === index ? 'true' : 'false'));

      // Keep the active thumbnail in view without scrolling the page itself.
      const thumb = this.thumbs[index];
      if (!thumb || !this.thumbList) return;
      const item = thumb.parentElement;
      const list = this.thumbList;
      if (item.offsetLeft < list.scrollLeft) {
        list.scrollLeft = item.offsetLeft;
      } else if (item.offsetLeft + item.offsetWidth > list.scrollLeft + list.clientWidth) {
        list.scrollLeft = item.offsetLeft + item.offsetWidth - list.clientWidth;
      }
    }
  }

  customElements.define('fm-gallery', FmGallery);
}

/* --------------------------------------------------- recently viewed rail */

if (!customElements.get('fm-recently-viewed')) {
  const KEY = 'fm:recently-viewed';
  const MAX = 12;

  /** Browser storage can throw (private mode, blocked cookies); never let it break the page. */
  const readIds = () => {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw).filter((id) => typeof id === 'number') : [];
    } catch {
      return [];
    }
  };

  const writeIds = (ids) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX)));
    } catch {
      /* not fatal */
    }
  };

  class FmRecentlyViewed extends HTMLElement {
    async connectedCallback() {
      const current = parseInt(this.dataset.productId, 10);

      // Record the product being viewed, most recent first.
      if (current) {
        const ids = readIds().filter((id) => id !== current);
        ids.unshift(current);
        writeIds(ids);
      }

      const ids = readIds().filter((id) => id !== current);
      if (!ids.length || !this.dataset.url) return this.remove();

      // Shopify's search endpoint takes an id:… query, so one request covers all.
      const query = ids.map((id) => `id:${id}`).join(' OR ');
      const url = `${this.dataset.url}?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=${ids.length}&section_id=${this.dataset.sectionId}`;

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(response.statusText);
        const markup = await response.text();
        const rail = new DOMParser().parseFromString(markup, 'text/html').querySelector('[data-fm-rail-items]');
        const target = this.querySelector('[data-fm-rail-items]');
        if (rail && target && rail.children.length) {
          target.innerHTML = rail.innerHTML;
          this.hidden = false;
          // The scroller measured itself while empty.
          this.querySelectorAll('fm-scroller').forEach((s) => s.syncArrows?.());
        } else {
          this.remove();
        }
      } catch {
        this.remove();
      }
    }
  }

  customElements.define('fm-recently-viewed', FmRecentlyViewed);
}

/* ----------------------------------------------------------- custom order */

if (!customElements.get('fm-custom-order')) {
  class FmCustomOrder extends HTMLElement {
    connectedCallback() {
      this.toggle = this.querySelector('[data-fm-custom-toggle]');
      this.panel = this.querySelector('[data-fm-custom-panel]');
      if (!this.toggle || !this.panel) return;

      this.fields = Array.from(this.panel.querySelectorAll('input, textarea'));

      if (this.dataset.fmMode === 'variant') {
        this.form = document.getElementById(this.dataset.fmForm);
        this.variantInput = this.form?.querySelector('input[name="id"]');
        this.submit = this.form?.querySelector('[name="add"]');
        this.originalVariant = this.variantInput?.value;
        this.originalLabel = this.submit?.querySelector('span')?.textContent;
        // Remember whether the button started disabled (a sold-out product),
        // so closing the panel restores exactly that state.
        this.wasDisabled = this.submit?.disabled === true;
      }

      this.setOpen(false);

      this.toggle.addEventListener('click', () => {
        this.setOpen(this.toggle.getAttribute('aria-pressed') !== 'true');
      });

      // Picking a stocked size means they no longer want a custom order.
      const picker = this.closest('.fm-pdp__info')?.querySelector('variant-selects');
      if (picker) picker.addEventListener('change', () => this.setOpen(false));
    }

    setOpen(open) {
      this.toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
      this.panel.hidden = !open;

      // Disabled fields are not submitted, so an unopened form adds no
      // empty line item properties to the cart.
      this.fields.forEach((field) => {
        field.disabled = !open;
        if (field.dataset.fmRequired !== undefined) field.required = open;
      });

      // Point the product form at the always-in-stock custom order variant, so
      // the product being sold out no longer blocks the add.
      if (this.dataset.fmMode === 'variant' && this.variantInput) {
        const customId = this.dataset.fmVariant;
        if (open && customId) {
          this.variantInput.value = customId;
          if (this.submit) {
            this.submit.disabled = false;
            const label = this.submit.querySelector('span');
            if (label && this.dataset.fmAddLabel) label.textContent = this.dataset.fmAddLabel;
          }
        } else {
          this.variantInput.value = this.originalVariant ?? this.variantInput.value;
          if (this.submit) {
            this.submit.disabled = this.wasDisabled;
            const label = this.submit.querySelector('span');
            if (label && this.originalLabel) label.textContent = this.originalLabel;
          }
        }
      }

      if (open) this.fields[0]?.focus();
    }
  }

  customElements.define('fm-custom-order', FmCustomOrder);
}

/* -------------------------------------------------------- size chart modal */

if (!customElements.get('fm-size-chart')) {
  class FmSizeChart extends HTMLElement {
    connectedCallback() {
      this.dialog = this.querySelector('dialog');
      const opener = this.querySelector('[data-fm-sizechart-open]');
      if (!this.dialog || !opener) return;

      opener.addEventListener('click', (event) => {
        event.preventDefault();
        // showModal gives focus trapping and Esc for free.
        if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
        else this.dialog.setAttribute('open', '');
      });

      this.querySelector('[data-fm-sizechart-close]')?.addEventListener('click', () => this.close());

      // Click outside the panel closes it; the dialog element itself is the backdrop.
      this.dialog.addEventListener('click', (event) => {
        if (event.target === this.dialog) this.close();
      });
    }

    close() {
      if (typeof this.dialog.close === 'function') this.dialog.close();
      else this.dialog.removeAttribute('open');
    }
  }

  customElements.define('fm-size-chart', FmSizeChart);
}
