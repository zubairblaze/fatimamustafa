/**
 * FM — behaviour for the custom homepage sections.
 *
 * Three custom elements, each progressive: the markup is usable without JS
 * (the scrollers are native overflow scrollers, the tab panels all render,
 * the hero shows its first slide), and these upgrade it in place.
 */

/* ---------------------------------------------------------------- scroller */

if (!customElements.get('fm-scroller')) {
  class FmScroller extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('[data-fm-track]');
      if (!this.track) return;

      this.prev = this.querySelector('[data-fm-prev]');
      this.next = this.querySelector('[data-fm-next]');
      this.progress = this.querySelector('[data-fm-progress]');

      this.onScroll = this.throttle(() => this.syncArrows());
      this.track.addEventListener('scroll', this.onScroll);

      if (this.prev) this.prev.addEventListener('click', () => this.scrollByPage(-1));
      if (this.next) this.next.addEventListener('click', () => this.scrollByPage(1));

      this.resizeObserver = new ResizeObserver(() => this.syncArrows());
      this.resizeObserver.observe(this.track);

      this.syncArrows();
    }

    disconnectedCallback() {
      if (this.track) this.track.removeEventListener('scroll', this.onScroll);
      if (this.resizeObserver) this.resizeObserver.disconnect();
    }

    /** One "page" is the visible width, less a sliver so context carries over. */
    scrollByPage(direction) {
      const item = this.track.querySelector(':scope > *');
      const step = item ? item.getBoundingClientRect().width + this.gap() : this.track.clientWidth;
      const perPage = Math.max(1, Math.floor(this.track.clientWidth / step));
      this.track.scrollBy({ left: direction * step * perPage, behavior: 'smooth' });
    }

    gap() {
      return parseFloat(getComputedStyle(this.track).columnGap) || 0;
    }

    syncArrows() {
      // Sub-pixel layout rounding means the ends never land exactly on 0 or max.
      const max = this.track.scrollWidth - this.track.clientWidth;
      const atStart = this.track.scrollLeft <= 1;
      const atEnd = this.track.scrollLeft >= max - 1;
      const noOverflow = max <= 1;

      if (this.prev) this.prev.disabled = atStart || noOverflow;
      if (this.next) this.next.disabled = atEnd || noOverflow;
      this.toggleAttribute('data-fm-static', noOverflow);

      if (this.progress) {
        const visible = this.track.clientWidth / this.track.scrollWidth;
        const travelled = noOverflow ? 0 : this.track.scrollLeft / max;
        const width = Math.min(1, visible) * 100;
        this.progress.style.width = `${width}%`;
        this.progress.style.transform = `translateX(${(travelled * (100 - width) * 100) / width}%)`;
      }
    }

    throttle(fn) {
      let frame = null;
      return () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          fn();
        });
      };
    }
  }

  customElements.define('fm-scroller', FmScroller);
}

/* -------------------------------------------------------------------- tabs */

if (!customElements.get('fm-tabs')) {
  class FmTabs extends HTMLElement {
    connectedCallback() {
      this.tabs = Array.from(this.querySelectorAll('[data-fm-tab]'));
      this.panels = Array.from(this.querySelectorAll('[data-fm-panel]'));
      if (!this.tabs.length) return;

      this.tabs.forEach((tab, index) => {
        tab.addEventListener('click', () => this.select(index));
        tab.addEventListener('keydown', (event) => this.onKeydown(event, index));
      });

      this.select(0);
    }

    select(index) {
      this.tabs.forEach((tab, i) => {
        const active = i === index;
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
      });

      this.panels.forEach((panel, i) => {
        const active = i === index;
        panel.hidden = !active;
        // Nested scrollers sized while hidden report a zero-width track.
        if (active) {
          panel.querySelectorAll('fm-scroller').forEach((scroller) => {
            if (typeof scroller.syncArrows === 'function') scroller.syncArrows();
          });
        }
      });
    }

    onKeydown(event, index) {
      const keys = { ArrowRight: 1, ArrowLeft: -1 };
      const step = keys[event.key];
      if (!step) return;
      event.preventDefault();
      const next = (index + step + this.tabs.length) % this.tabs.length;
      this.select(next);
      this.tabs[next].focus();
    }
  }

  customElements.define('fm-tabs', FmTabs);
}

/* -------------------------------------------------------------------- hero */

if (!customElements.get('fm-hero')) {
  class FmHero extends HTMLElement {
    connectedCallback() {
      this.slides = Array.from(this.querySelectorAll('[data-fm-slide]'));
      this.dots = Array.from(this.querySelectorAll('[data-fm-dot]'));
      if (this.slides.length < 2) return;

      this.index = 0;
      this.interval = parseInt(this.dataset.interval, 10) || 0;

      this.dots.forEach((dot, i) => dot.addEventListener('click', () => {
        this.goTo(i);
        this.restart();
      }));

      this.addEventListener('mouseenter', () => this.stop());
      this.addEventListener('mouseleave', () => this.start());
      this.addEventListener('focusin', () => this.stop());
      this.addEventListener('focusout', () => this.start());

      this.goTo(0);
      this.start();
    }

    disconnectedCallback() {
      this.stop();
    }

    goTo(index) {
      this.index = index;
      this.slides.forEach((slide, i) => {
        const active = i === index;
        slide.classList.toggle('fm-hero__slide--active', active);
        slide.setAttribute('aria-hidden', active ? 'false' : 'true');
        // Keep offscreen slides out of the tab order.
        slide.querySelectorAll('a, button').forEach((el) => {
          el.tabIndex = active ? 0 : -1;
        });
      });
      this.dots.forEach((dot, i) => {
        dot.classList.toggle('fm-hero__dot--active', i === index);
        dot.setAttribute('aria-current', i === index ? 'true' : 'false');
      });
    }

    start() {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!this.interval || reduced || this.timer) return;
      this.timer = setInterval(() => this.goTo((this.index + 1) % this.slides.length), this.interval);
    }

    stop() {
      if (!this.timer) return;
      clearInterval(this.timer);
      this.timer = null;
    }

    restart() {
      this.stop();
      this.start();
    }
  }

  customElements.define('fm-hero', FmHero);
}
