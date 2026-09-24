/**
 * FM — product page behaviour: the media gallery and the recently-viewed rail.
 *
 * Guarded on customElements.get, like the other FM elements, because more than
 * one section on the page can load this file.
 */

/* ----------------------------------------------------------------- gallery */

if (!customElements.get('fm-gallery')) {
  class FmGallery extends HTMLElement {
    connectedCallback() {
      this.main = this.querySelector('.fm-gallery__main img');
      this.thumbs = Array.from(this.querySelectorAll('[data-fm-thumb]'));
      if (!this.main || this.thumbs.length < 2) return;

      this.thumbs.forEach((thumb, index) => {
        thumb.addEventListener('click', () => this.show(index));
      });
    }

    show(index) {
      const thumb = this.thumbs[index];
      const full = thumb.dataset.full;
      if (!full) return;

      // srcset would otherwise keep winning over the new src.
      this.main.removeAttribute('srcset');
      this.main.src = full;
      this.main.alt = thumb.dataset.alt || '';

      this.thumbs.forEach((t, i) => t.setAttribute('aria-current', i === index ? 'true' : 'false'));
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
