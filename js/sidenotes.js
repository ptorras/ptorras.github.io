/**
 * Converts Hugo/Goldmark's default footnote markup into Tufte-style side
 * notes, in place, leaving the original footnote list at the bottom of the
 * article as a no-JS fallback (hidden via CSS once this runs).
 *
 * Expected input per footnote, anywhere in .article-content:
 *   <sup id="fnref:N"><a href="#fn:N" class="footnote-ref">N</a></sup>
 * and, inside a trailing `.footnotes` block:
 *   <li id="fn:N"><p>Note text. <a class="footnote-backref">...</a></p></li>
 */
(function () {
  "use strict";

  var article = document.querySelector(".article-content");
  if (!article) return;

  var refs = article.querySelectorAll("sup[id^='fnref:'] > a.footnote-ref");
  if (!refs.length) return;

  refs.forEach(function (ref, index) {
    var sup = ref.parentNode;
    var id = sup.id.replace(/^fnref:/, "");
    var definition = article.parentNode.querySelector("#fn\\:" + CSS.escape(id));
    if (!definition) return;

    var number = ref.textContent.trim();
    var noteId = "sn-" + id;

    // Strip the backreference link; it's meaningless once the note lives
    // next to its reference instead of in a separate list.
    var content = definition.cloneNode(true);
    var backref = content.querySelector("a.footnote-backref");
    if (backref) backref.remove();

    var label = document.createElement("label");
    label.setAttribute("for", noteId);
    label.className = "sidenote-toggle";
    label.textContent = "[note " + number + "]";

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = noteId;
    checkbox.className = "sidenote-checkbox";

    var note = document.createElement("span");
    note.className = "sidenote";
    var numberSpan = document.createElement("span");
    numberSpan.className = "sidenote-number";
    numberSpan.textContent = number;
    note.appendChild(numberSpan);
    while (content.firstChild) note.appendChild(content.firstChild);

    var refLink = document.createElement("a");
    refLink.href = "#" + noteId;
    refLink.className = "sidenote-ref";
    refLink.textContent = number;
    refLink.setAttribute("role", "doc-noteref");

    sup.replaceWith(refLink, label, checkbox, note);
  });

  var footnotesBlock = document.querySelector(".footnotes");
  if (footnotesBlock) footnotesBlock.setAttribute("hidden", "");
})();
