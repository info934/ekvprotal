import createDOMPurify from 'dompurify';

const getDomPurify = () => {
  if (typeof window === 'undefined' || !window.document) return null;
  return createDOMPurify(window);
};

const TEMPLATE_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  WHOLE_DOCUMENT: false,
  ADD_TAGS: ['style'],
  ADD_ATTR: ['style', 'class', 'target'],
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'option', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'srcdoc'],
};

const DOCUMENT_SANITIZE_CONFIG = {
  ...TEMPLATE_SANITIZE_CONFIG,
  WHOLE_DOCUMENT: true,
  ADD_TAGS: ['html', 'head', 'body', 'main', 'style'],
  ADD_ATTR: ['style', 'class', 'target', 'lang', 'charset'],
};

export const sanitizeDocumentTemplateHtml = (html) => {
  const input = String(html || '');
  const purifier = getDomPurify();
  if (!purifier) return input;

  return purifier.sanitize(input, TEMPLATE_SANITIZE_CONFIG);
};

export const sanitizeGeneratedDocumentHtml = (html) => {
  const input = String(html || '');
  const purifier = getDomPurify();
  if (!purifier) return input;

  const isWholeDocument = /<!doctype html|<html[\s>]/i.test(input);
  return purifier.sanitize(input, isWholeDocument ? DOCUMENT_SANITIZE_CONFIG : TEMPLATE_SANITIZE_CONFIG);
};

