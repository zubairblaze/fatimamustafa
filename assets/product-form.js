if (!customElements.get('product-form')) {
  customElements.define(
    'product-form',
    class ProductForm extends HTMLElement {
      constructor() {
        super();

        this.form = this.querySelector('form');
        this.variantIdInput.disabled = false;
        this.form.addEventListener('submit', this.onSubmitHandler.bind(this));
        this.cart = document.querySelector('cart-notification') || document.querySelector('cart-drawer');
        this.submitButton = this.querySelector('[type="submit"]');
        this.submitButtonText = this.submitButton.querySelector('span');

        if (document.querySelector('cart-drawer')) this.submitButton.setAttribute('aria-haspopup', 'dialog');

        this.hideErrors = this.dataset.hideErrors === 'true';
      }

      onSubmitHandler(evt) {
        evt.preventDefault();
        if (this.submitButton.getAttribute('aria-disabled') === 'true') return;

        this.handleErrorMessage();

        this.submitButton.setAttribute('aria-disabled', true);
        this.submitButton.classList.add('loading');
        this.querySelector('.loading__spinner').classList.remove('hidden');

        const config = fetchConfig('javascript');
        config.headers['X-Requested-With'] = 'XMLHttpRequest';
        delete config.headers['Content-Type'];

        const formData = new FormData(this.form);
        if (this.cart) {
          formData.append(
            'sections',
            this.cart.getSectionsToRender().map((section) => section.id)
          );
          formData.append('sections_url', window.location.pathname);
          this.cart.setActiveElement(document.activeElement);
        }
        config.body = formData;

        const variantId = formData.get('id');
        const quantity = parseInt(formData.get('quantity')) || 1;
        const linesUpdateDeferred = this.createCartLinesUpdateEvent(variantId, quantity);

        // FM add-ons: ticked add-on variants go into the cart as their own lines
        // in the same request, so their prices reach the cart total and the order.
        const addonItems = this.getAddonItems(quantity);
        if (addonItems.length) {
          config.headers['Content-Type'] = 'application/json';
          config.body = JSON.stringify(this.buildItemsPayload(formData, addonItems));
        }

        fetch(`${routes.cart_add_url}`, config)
          .then((response) => response.json())
          .then((response) => {
            // A multi-item add answers with { items, sections }. The cart
            // notification and subscribers expect a single line, so point them
            // at the product line, which is always first.
            if (Array.isArray(response.items) && !response.status && !response.key) {
              Object.assign(response, response.items[0]);
            }
            if (response.status) {
              publish(PUB_SUB_EVENTS.cartError, {
                source: 'product-form',
                productVariantId: variantId,
                errors: response.errors || response.description,
                message: response.message,
              });
              this.handleErrorMessage(response.description);
              this.dispatchCartErrorEvent(response.description || response.message, 'INVALID');
              linesUpdateDeferred?.reject(new Error(response.description || response.message));

              const soldOutMessage = this.submitButton.querySelector('.sold-out-message');
              if (!soldOutMessage) return;
              this.submitButton.setAttribute('aria-disabled', true);
              this.submitButtonText.classList.add('hidden');
              soldOutMessage.classList.remove('hidden');
              this.error = true;
              return;
            } else if (!this.cart) {
              this.resolveCartLinesUpdate(linesUpdateDeferred);
              window.location = window.routes.cart_url;
              return;
            }

            this.resolveCartLinesUpdate(linesUpdateDeferred);

            const startMarker = CartPerformance.createStartingMarker('add:wait-for-subscribers');
            if (!this.error)
              publish(PUB_SUB_EVENTS.cartUpdate, {
                source: 'product-form',
                productVariantId: variantId,
                cartData: response,
              }).then(() => {
                CartPerformance.measureFromMarker('add:wait-for-subscribers', startMarker);
              });
            this.error = false;
            const quickAddModal = this.closest('quick-add-modal');
            if (quickAddModal) {
              document.body.addEventListener(
                'modalClosed',
                () => {
                  setTimeout(() => {
                    CartPerformance.measure("add:paint-updated-sections", () => {
                      this.cart.renderContents(response);
                    });
                  });
                },
                { once: true }
              );
              quickAddModal.hide(true);
            } else {
              CartPerformance.measure("add:paint-updated-sections", () => {
                this.cart.renderContents(response);
              });
            }
          })
          .catch((e) => {
            console.error(e);
            this.dispatchCartErrorEvent(e.message || 'Network error', 'SERVICE_UNAVAILABLE');
            linesUpdateDeferred?.reject(e);
          })
          .finally(() => {
            this.submitButton.classList.remove('loading');
            if (this.cart && this.cart.classList.contains('is-empty')) this.cart.classList.remove('is-empty');
            if (!this.error) this.submitButton.removeAttribute('aria-disabled');
            this.querySelector('.loading__spinner').classList.add('hidden');

            CartPerformance.measureFromEvent("add:user-action", evt);
          });
      }

      /**
       * FM add-ons ticked for this form, as cart items. Each one is added once
       * per garment ordered, and carries a "For" property naming the product
       * (and size) it belongs to, so the order can be made up correctly.
       */
      getAddonItems(quantity) {
        // Add-on checklists for this product, wherever they sit on the page: in
        // the product section's Add-ons block or in the Product add-ons section.
        const productId = this.dataset.productId;
        if (!productId) return [];
        const groups = Array.from(document.querySelectorAll(`[data-fm-addons-product="${productId}"]`));
        if (!groups.length) return [];

        // If the checklist appears twice (block and section), count each add-on once.
        const ids = new Set();
        groups.forEach((group) =>
          group.querySelectorAll('[data-fm-addon]:checked:not(:disabled)').forEach((input) => ids.add(input.value))
        );
        if (!ids.size) return [];

        let forLabel = groups[0].dataset.fmAddonsFor || '';
        const selected = document
          .querySelector(`[data-section="${this.dataset.sectionId}"] [data-selected-variant]`)
          ?.textContent;
        try {
          const variant = selected ? JSON.parse(selected) : null;
          if (variant && variant.title && variant.title !== 'Default Title') forLabel += ` - ${variant.title}`;
        } catch {
          /* the product title alone is enough */
        }

        return Array.from(ids).map((id) => ({
          id: Number(id),
          quantity,
          properties: forLabel ? { For: forLabel } : {},
        }));
      }

      /**
       * The same request the form would send, as a multi-item JSON body: the
       * product line first (with its line item properties and selling plan),
       * then the add-on lines.
       */
      buildItemsPayload(formData, addonItems) {
        const main = {
          id: Number(formData.get('id')),
          quantity: parseInt(formData.get('quantity')) || 1,
          properties: {},
        };

        for (const [name, value] of formData.entries()) {
          const match = name.match(/^properties\[(.+)\]$/);
          if (match && typeof value === 'string') main.properties[match[1]] = value;
        }
        if (formData.get('selling_plan')) main.selling_plan = formData.get('selling_plan');

        const payload = { items: [main, ...addonItems] };
        if (formData.get('sections')) {
          payload.sections = formData.get('sections');
          payload.sections_url = formData.get('sections_url');
        }
        return payload;
      }

      handleErrorMessage(errorMessage = false) {
        if (this.hideErrors) return;

        this.errorMessageWrapper =
          this.errorMessageWrapper || this.querySelector('.product-form__error-message-wrapper');
        if (!this.errorMessageWrapper) return;
        this.errorMessage = this.errorMessage || this.errorMessageWrapper.querySelector('.product-form__error-message');

        this.errorMessageWrapper.toggleAttribute('hidden', !errorMessage);

        if (errorMessage) {
          this.errorMessage.textContent = errorMessage;
        }
      }

      toggleSubmitButton(disable = true, text) {
        if (disable) {
          this.submitButton.setAttribute('disabled', 'disabled');
          if (text) this.submitButtonText.textContent = text;
        } else {
          this.submitButton.removeAttribute('disabled');
          this.submitButtonText.textContent = window.variantStrings.addToCart;
        }
      }

      createCartLinesUpdateEvent(variantId, quantity) {
        const { CartLinesUpdateEvent } = window.StandardEvents || {};
        if (!CartLinesUpdateEvent) return null;

        const deferred = CartLinesUpdateEvent.createPromise();
        this.dispatchEvent(
          new CartLinesUpdateEvent({
            action: 'add',
            context: 'product',
            lines: [{ merchandiseId: variantId, quantity }],
            promise: deferred.promise,
          })
        );
        return deferred;
      }

      resolveCartLinesUpdate(deferred) {
        if (!deferred) return;
        const { CartLinesUpdateEvent } = window.StandardEvents || {};
        if (!CartLinesUpdateEvent) return;

        const pendingCartDataPromise = typeof CartItems !== 'undefined'
          ? CartItems.fetchCartData()
          : fetch(`${routes.cart_url}.json`).then((response) => response.json());

        pendingCartDataPromise
          .then((cart) => {
            if (!cart?.currency) return deferred.reject(new Error('Missing currency in cart response'));
            deferred.resolve({ cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart) });
          })
          .catch((e) => deferred.reject(e));
      }

      dispatchCartErrorEvent(message, code) {
        const { CartErrorEvent } = window.StandardEvents || {};
        if (!CartErrorEvent) return;
        this.dispatchEvent(new CartErrorEvent({ error: message, code }));
      }

      get variantIdInput() {
        return this.form.querySelector('[name=id]');
      }
    }
  );
}
