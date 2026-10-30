# Rebuilding the Author Packet

The packet files in `authors/packet/` are made by these two scripts. Change
the wording here, then rebuild:

```
node authors/packet/build/submission-form.cjs authors/packet/Story-Submission-Form.docx      # needs the docx npm package
python3 authors/packet/build/author-guide.py authors/packet/Author-Packet-Writing-and-Upload-Guide.pdf   # needs reportlab
```

Keep them in step with `authors/submissions/TEMPLATE.md` and
`scripts/check-story-submission.mjs`: the form, the guide, the template and the
checker must all ask for the same fields.
