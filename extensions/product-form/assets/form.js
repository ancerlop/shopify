(function() {
  const container = document.getElementById('escape-room-fields');
  if (!container) return;

  // Relocate the container inside the Shopify product form so inputs are submitted with the cart
  const productForm = document.querySelector('form[action*="/cart/add"]');
  if (productForm) {
    const submitWrapper = productForm.querySelector('.product-form__buttons') || 
                          productForm.querySelector('[class*="buttons"]') || 
                          productForm.querySelector('button[name="add"]') || 
                          productForm.querySelector('button[type="submit"]') || 
                          productForm.lastElementChild;
    if (submitWrapper) {
      productForm.insertBefore(container, submitWrapper);
    } else {
      productForm.appendChild(container);
    }
  }

  const productId = container.dataset.productId;
  const proxyUrl = (container.dataset.proxyUrl || '/apps/escape-room') + '/form-config/' + productId;
  if (!productId) {
    console.error('[Escape Room] No product ID configured in block settings');
    return;
  }

  fetch(proxyUrl)
    .then(r => r.json())
    .then(data => {
      if (!data.fields || data.fields.length === 0) return;
      renderFields(data.fields);
    })
    .catch(() => console.error('[Escape Room] Failed to load form config'));

  function sanitizeId(label) {
    return label.replace(/[^a-zA-Z0-9-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  }

  function calculateMaxLength(limits) {
    if (!limits || !limits.maxWidth || !limits.fontSize) return null;
    const charsPerLine = Math.floor(limits.maxWidth / (limits.fontSize * 0.6));
    const lines = limits.imageHeight ? Math.max(1, Math.floor(limits.imageHeight / (limits.fontSize * 1.2))) : 1;
    return charsPerLine * lines;
  }

  function renderFields(fields) {
    const sorted = fields.sort((a, b) => a.sortOrder - b.sortOrder);

    sorted.forEach(field => {
      const wrapper = document.createElement('div');
      wrapper.className = 'escape-room-field';

      const fieldId = `escape-${sanitizeId(field.label)}`;

      const label = document.createElement('label');
      label.textContent = field.label + (field.required ? ' *' : '');
      label.setAttribute('for', fieldId);
      wrapper.appendChild(label);

      let maxLength = null;
      if (field.limits && field.type !== 'image') {
        maxLength = calculateMaxLength(field.limits);
      }

      if (field.type === 'textarea') {
        const textarea = document.createElement('textarea');
        textarea.id = fieldId;
        textarea.name = `properties[${field.label}]`;
        textarea.required = field.required;
        if (maxLength) textarea.maxLength = maxLength;
        wrapper.appendChild(textarea);
        
        if (maxLength) {
          const hint = document.createElement('span');
          hint.className = 'escape-room-hint';
          hint.style.fontSize = '0.8em';
          hint.style.color = '#666';
          hint.style.display = 'block';
          hint.textContent = `Máximo ${maxLength} caracteres`;
          wrapper.appendChild(hint);
        }
      } else if (field.type === 'image') {
        const input = document.createElement('input');
        input.type = 'file';
        input.id = fieldId;
        input.accept = 'image/*';
        input.required = field.required;
        wrapper.appendChild(input);

        if (field.limits && field.limits.maxWidth && field.limits.imageHeight) {
          const hint = document.createElement('span');
          hint.className = 'escape-room-hint';
          hint.style.fontSize = '0.8em';
          hint.style.color = '#666';
          hint.style.display = 'block';
          hint.textContent = `Dimensiones recomendadas del recuadro: ${field.limits.maxWidth}x${field.limits.imageHeight} pts.`;
          wrapper.appendChild(hint);
        }

        const hiddenInput = document.createElement('input');
        hiddenInput.type = 'hidden';
        hiddenInput.name = `properties[${field.label}]`;
        hiddenInput.required = field.required;
        wrapper.appendChild(hiddenInput);

        const status = document.createElement('span');
        status.className = 'escape-room-upload-status';
        status.style.fontSize = '0.9em';
        status.style.marginLeft = '10px';
        wrapper.appendChild(status);

        input.addEventListener('change', function(e) {
          const file = e.target.files[0];
          if (!file) return;

          status.textContent = 'Subiendo imagen...';
          status.style.color = '#333';
          hiddenInput.value = '';

          const reader = new FileReader();
          reader.onload = function(evt) {
            const dataUrl = evt.target.result;
            const base64Data = dataUrl.split(',')[1];

            fetch('/apps/escape-room/upload', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                filename: file.name,
                type: file.type,
                base64: base64Data
              })
            })
              .then(r => r.json())
              .then(res => {
                if (res.error) {
                  status.textContent = 'Error: ' + res.error;
                  status.style.color = 'red';
                } else if (res.url) {
                  hiddenInput.value = res.url;
                  status.textContent = '✓ Imagen lista';
                  status.style.color = 'green';
                }
              })
              .catch(err => {
                console.error(err);
                status.textContent = 'Error al subir';
                status.style.color = 'red';
              });
          };
          reader.onerror = function() {
            status.textContent = 'Error al leer el archivo';
            status.style.color = 'red';
          };
          reader.readAsDataURL(file);
        });
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = fieldId;
        input.name = `properties[${field.label}]`;
        input.placeholder = `Introduce ${field.label.toLowerCase()}`;
        input.required = field.required;
        if (maxLength) input.maxLength = maxLength;
        wrapper.appendChild(input);

        if (maxLength) {
          const hint = document.createElement('span');
          hint.className = 'escape-room-hint';
          hint.style.fontSize = '0.8em';
          hint.style.color = '#666';
          hint.style.display = 'block';
          hint.textContent = `Máximo ${maxLength} caracteres`;
          wrapper.appendChild(hint);
        }
      }

      container.appendChild(wrapper);
    });
  }
})();
