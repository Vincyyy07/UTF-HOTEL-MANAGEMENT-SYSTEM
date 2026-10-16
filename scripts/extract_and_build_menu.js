const fs = require('fs');
const readline = require('readline');
const path = require('path');

async function main() {
  const transcriptPath = 'C:\\Users\\Dell\\.gemini\\antigravity\\brain\\f9cbefd9-fe60-40fc-a2a1-545ca3740208\\.system_generated\\logs\\transcript_full.jsonl';
  const fileStream = fs.createReadStream(transcriptPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let rawContent = '';
  for await (const line of rl) {
    if (line.includes('"step_index":3323')) {
      const obj = JSON.parse(line);
      rawContent = obj.content;
      break;
    }
  }

  if (!rawContent) {
    console.error('Could not find step 3323');
    process.exit(1);
  }

  console.log('Found step 3323 content length:', rawContent.length);

  // Extract all json arrays using regex
  const regex = /\[\s*\{[\s\S]*?\}\s*\]/g;
  const matches = rawContent.match(regex);
  console.log('Matches count:', matches ? matches.length : 0);

  if (!matches) {
    console.error('No matches found!');
    process.exit(1);
  }

  let allRawItems = [];
  for (let i = 0; i < matches.length; i++) {
    try {
      const arr = JSON.parse(matches[i]);
      console.log(`Array ${i + 1}: ${arr.length} items (Category: ${arr[0]?.category})`);
      allRawItems = allRawItems.concat(arr);
    } catch (err) {
      console.error(`Failed to parse match ${i + 1}:`, err.message);
    }
  }

  console.log('Total raw items extracted:', allRawItems.length);

  // Define Category mapping and icons
  // 14 categories in order
  const categoryDefs = [
    { id: 'cat-soups', name: 'Soups', icon: 'soup_kitchen' },
    { id: 'cat-telugu', name: 'Telugu Ruchulu', icon: 'local_fire_department' },
    { id: 'cat-veg-starters', name: 'Veg Starters', icon: 'eco' },
    { id: 'cat-chicken-egg-starters', name: 'Chicken & Egg Starters', icon: 'kebab_dining' },
    { id: 'cat-tandoori', name: 'Tandoori', icon: 'outdoor_grill' },
    { id: 'cat-breads', name: 'Breads', icon: 'bakery_dining' },
    { id: 'cat-veg-curries', name: 'Vegetable Curries', icon: 'skillet' },
    { id: 'cat-nonveg-curries', name: 'Non-Veg Curries', icon: 'dinner_dining' },
    { id: 'cat-rice', name: 'Rice', icon: 'rice_bowl' },
    { id: 'cat-chinese', name: 'Chinese', icon: 'ramen_dining' },
    { id: 'cat-biryanis', name: 'Biryanis', icon: 'lunch_dining' },
    { id: 'cat-pulao', name: 'Pulao', icon: 'set_meal' },
    { id: 'cat-desserts', name: 'Desserts', icon: 'icecream' },
    { id: 'cat-beverages', name: 'Beverages', icon: 'local_bar' }
  ];

  const categories = categoryDefs.map((cat, idx) => ({
    id: cat.id,
    name: cat.name,
    icon: cat.icon,
    sortOrder: idx + 1,
    demoFlag: false
  }));

  // Build name to cat id map
  const catNameToId = {};
  categoryDefs.forEach(c => {
    catNameToId[c.name.toLowerCase().trim()] = c.id;
  });

  // Map each item
  const formattedItems = allRawItems.map((item, index) => {
    const rawCat = (item.category || '').toLowerCase().trim();
    let catId = catNameToId[rawCat];
    if (!catId) {
      // Fuzzy match
      const found = categoryDefs.find(c => c.name.toLowerCase().includes(rawCat) || rawCat.includes(c.name.toLowerCase()));
      if (found) {
        catId = found.id;
      } else {
        console.warn(`Unmatched category for item: ${item.name} (${item.category})`);
        catId = 'cat-veg-starters';
      }
    }

    let vegType = 'veg';
    const diet = (item.dietary || '').toLowerCase();
    if (diet.includes('egg')) {
      vegType = 'egg';
    } else if (diet.includes('non') || diet.includes('chicken') || diet.includes('mutton') || diet.includes('fish') || diet.includes('prawn') || diet.includes('seafood')) {
      vegType = 'non-veg';
    } else {
      vegType = 'veg';
    }

    return {
      id: `item-${index + 1}`,
      categoryId: catId,
      name: item.name.trim(),
      description: item.description || '',
      pricePaise: Math.round(Number(item.price) * 100),
      vegType: vegType,
      gstPercent: 5,
      isAvailable: true,
      preparationTimeMins: 15,
      isBestseller: !!item.chefSpecial,
      salesCount: 0,
      demoFlag: false
    };
  });

  console.log(`Generated ${formattedItems.length} menu items across ${categories.length} categories.`);

  // Save parsed items to a clean JSON for reference
  fs.writeFileSync(path.join(__dirname, 'clean_menu_data.json'), JSON.stringify({ categories, menuItems: formattedItems }, null, 2));

  // Update data/hms_db.json
  const dbPath = path.join(__dirname, '..', 'data', 'hms_db.json');
  if (fs.existsSync(dbPath)) {
    const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    db.categories = categories;
    db.menuItems = formattedItems;
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    console.log('Successfully updated data/hms_db.json!');
  }

  // Update lib/seed-data.ts
  const seedPath = path.join(__dirname, '..', 'lib', 'seed-data.ts');
  if (fs.existsSync(seedPath)) {
    let seedContent = fs.readFileSync(seedPath, 'utf8');
    
    // Replace INITIAL_CATEGORIES
    const catStr = `export const INITIAL_CATEGORIES: Category[] = ${JSON.stringify(categories, null, 2)};`;
    seedContent = seedContent.replace(/export const INITIAL_CATEGORIES: Category\[\] = [\s\S]*?;\n\nexport const INITIAL_MENU_ITEMS/, `${catStr}\n\nexport const INITIAL_MENU_ITEMS`);

    // Replace INITIAL_MENU_ITEMS
    const itemStr = `export const INITIAL_MENU_ITEMS: MenuItem[] = ${JSON.stringify(formattedItems, null, 2)};`;
    seedContent = seedContent.replace(/export const INITIAL_MENU_ITEMS: MenuItem\[\] = [\s\S]*?;\n\nexport const INITIAL_TABLES/, `${itemStr}\n\nexport const INITIAL_TABLES`);

    fs.writeFileSync(seedPath, seedContent, 'utf8');
    console.log('Successfully updated lib/seed-data.ts!');
  }
}

main().catch(console.error);
