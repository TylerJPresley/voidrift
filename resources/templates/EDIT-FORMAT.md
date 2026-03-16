# Aider Edit Format — Whole File

When editing or creating files, the file path MUST appear alone on its own line
immediately before the opening triple backticks. Never put the filename inside
the code block or omit it entirely.

## CORRECT

src/app/config.py
```python
class Config:
    pass
```

frontend/styles.css
```css
body { margin: 0; }
```

## WRONG — missing filename (creates a file named "python" or "code")

```python
class Config:
    pass
```

## WRONG — filename inside the code block

```python
# src/app/config.py
class Config:
    pass
```

Every file edit must follow the CORRECT pattern above. No exceptions.
