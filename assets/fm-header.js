/**
 * FM — announcement bar rotation.
 *
 * The header itself needs no JS beyond what Dawn already ships (menu-drawer
 * and predictive search come from global.js), so this file only carries the
 * announcement strip.
 */

if (!customElements.get('fm-announce')) {
  class FmAnnounce extends HTMLElement {
    connectedCallback() {
      this.messages = Array.from(this.querySelectorAll('[data-fm-message]'));
      if (!this.messages.length) return;

      this.index = 0;
      this.interval = parseInt(this.dataset.interval, 10) || 0;

      // Show the first message even when it's the only one.
      this.goTo(0);
      if (this.messages.length < 2) return;

      this.addEventListener('mouseenter', () => this.stop());
      this.addEventListener('mouseleave', () => this.start());
      this.start();
    }

    disconnectedCallback() {
      this.stop();
    }

    goTo(index) {
      this.index = index;
      this.messages.forEach((message, i) => {
        const active = i === index;
        message.classList.toggle('fm-announce__message--active', active);
        message.setAttribute('aria-hidden', active ? 'false' : 'true');
        message.querySelectorAll('a').forEach((a) => {
          a.tabIndex = active ? 0 : -1;
        });
      });
    }

    start() {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!this.interval || reduced || this.timer) return;
      this.timer = setInterval(
        () => this.goTo((this.index + 1) % this.messages.length),
        this.interval
      );
    }

    stop() {
      if (!this.timer) return;
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  customElements.define('fm-announce', FmAnnounce);
}
