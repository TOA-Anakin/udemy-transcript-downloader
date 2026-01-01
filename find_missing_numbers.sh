#!/bin/bash

# SCRIPT: find_missing_numbers.sh
# DESCRIPTION: Finds missing sequence numbers within the filenames
#              in a specified directory.
#              This version is optimized for files named like 'chapter_900.html'.

# --- Input Handling ---

# Check if a directory path was provided
if [ -z "$1" ]; then
    echo "Usage: $0 <directory_path>"
    echo "Example: $0 /path/to/my/files"
    exit 1
fi

# Store the provided directory path, removing trailing slashes for clean basename operations
SEARCH_DIR=$(echo "$1" | sed 's/\/$//')

# Check if the directory exists
if [ ! -d "$SEARCH_DIR" ]; then
    echo "Error: Directory '$SEARCH_DIR' not found."
    exit 1
fi

# --- Configuration ---
# The pattern below finds files named 'chapter_###.html' or 'Chapter_###.html' (case-insensitive).
FILENAME_PATTERN="[Cc]hapter_*.html"
# NEW REGEX using sed for extraction:
# s/.*[Cc]hapter_\([0-9]\+\)\.html$/\1/p
# This pattern matches the full filename, captures the number (\1), and prints only the number.

echo "--- Starting Missing Number Check ---"
echo "Searching directory: $SEARCH_DIR"
echo "Searching files matching pattern: ${FILENAME_PATTERN}"

# 1. Extract all numbers from the filenames
# find: Finds all files matching the pattern.
# xargs -0 -n 1 basename: Safely strips the directory prefix by running 'basename' once per file.
# sed: Extracts the number using a standard regex capture group.
# sort -n | uniq: Sorts numerically and removes duplicates.
FILE_NUMBERS=$(find "$SEARCH_DIR" -maxdepth 1 -type f -name "$FILENAME_PATTERN" -print0 | 
               xargs -0 -n 1 basename | 
               sed -n -E 's/.*[Cc]hapter_([0-9]+)\.html$/\1/p' | 
               sort -n | 
               uniq)

# Check if any numbers were found
if [ -z "$FILE_NUMBERS" ]; then
    echo "Error: No numbers found in the filenames in '$SEARCH_DIR' matching the pattern: ${FILENAME_PATTERN}."
    echo "Please check the directory path and the file naming convention (e.g., Chapter_900.html)."
    exit 1
fi

# 2. Find the minimum and maximum numbers
MIN_NUM=$(echo "$FILE_NUMBERS" | head -n 1)
MAX_NUM=$(echo "$FILE_NUMBERS" | tail -n 1)

echo "Lowest number found: $MIN_NUM"
echo "Highest number found: $MAX_NUM"

# Initialize an array of all present numbers for quick lookup
declare -A PRESENT
for num in $FILE_NUMBERS; do
    PRESENT[$num]=1
done

# Initialize list for missing numbers
MISSING_NUMBERS=""
MISSING_COUNT=0

# 3. Iterate from min to max and check for presence
# We use shell arithmetic for iteration
for (( i=$MIN_NUM; i<=$MAX_NUM; i++ )); do
    # Check if the number 'i' is NOT a key in the PRESENT array
    if [ -z "${PRESENT[$i]}" ]; then
        # If it's not present, add it to the missing list
        MISSING_NUMBERS+="$i "
        MISSING_COUNT=$((MISSING_COUNT + 1))
    fi
done

# 4. Report the results
echo "-------------------------------------"
if [ $MISSING_COUNT -eq 0 ]; then
    echo "✅ Success! No missing numbers found in the sequence."
else
    echo "❌ MISSING NUMBERS DETECTED (Total: $MISSING_COUNT):"
    # Use xargs to print the list cleanly in one line
    echo "$MISSING_NUMBERS" | xargs
fi

echo "--- Check Complete ---"
