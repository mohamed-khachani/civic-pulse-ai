
from pathlib import Path
import argparse


def split_urls(input_file: str, output_dir: str, num_files: int, name: str):
    if num_files < 1:
        raise ValueError("Number of files must be at least 1")

    if not name or not name.replace("-", "").replace("_", "").isalnum():
        raise ValueError("Name must contain only letters, numbers, - or _")

    input_path = Path(input_file)
    output_path = Path(output_dir)

    if not input_path.is_file():
        raise FileNotFoundError(f"File not found: {input_path}")

    output_path.mkdir(parents=True, exist_ok=True)

    with input_path.open("r", encoding="utf-8-sig") as f:
        urls = [line.strip() for line in f if line.strip()]

    total = len(urls)
    base_size, remainder = divmod(total, num_files)

    start = 0

    for i in range(1, num_files + 1):
        size = base_size + (1 if i <= remainder else 0)
        chunk = urls[start:start + size]

        filename = output_path / f"urls_{name}-{i}.txt"

        with filename.open("w", encoding="utf-8") as f:
            if chunk:
                f.write("\n".join(chunk) + "\n")

        print(f"{filename}: {len(chunk)} URLs")
        start += size

    print(f"\nDone! {total} URLs split into {num_files} files.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Split URLs into equally sized files."
    )

    parser.add_argument("--input", default="urls.txt")
    parser.add_argument("--output", default="split_urls")
    parser.add_argument("--parts", type=int, required=True)
    parser.add_argument("--name", type=str, required=True)

    args = parser.parse_args()

    split_urls(args.input, args.output, args.parts, args.name)
