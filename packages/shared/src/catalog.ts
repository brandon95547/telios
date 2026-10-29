// Written by scripts/sync-catalog.mjs from Talari's lists (Phansora's model.js and art-filters.js,
// and the API's styles.py). Do not edit by hand: change them there and run the script again.

export interface Look { id: string; label: string; words: string }
export interface Catalog {
  artStyles: (Look & { substyles: Look[] })[];
  mediums: Look[];
  themes: { label: string; options: { id: string; label: string }[] }[];
}

export const CATALOG: Catalog = {
 "artStyles": [
  {
   "id": "realism",
   "label": "Realism",
   "words": "photorealistic illustration, lifelike proportions, natural light, crisp true-to-life detail and texture",
   "substyles": [
    {
     "id": "fantastic-realism",
     "label": "Fantastic Realism",
     "words": "fantastic realism, mythic and otherworldly subjects painted with meticulous lifelike detail"
    },
    {
     "id": "biomechanical",
     "label": "Biomechanical",
     "words": "biomechanical art, organic forms fused with machinery, ribbed metallic textures, intricate surreal anatomy"
    },
    {
     "id": "magical-realism",
     "label": "Magical Realism",
     "words": "magical realism, an everyday scene painted realistically with one quiet impossible element, calm luminous mood"
    }
   ]
  },
  {
   "id": "impressionism",
   "label": "Impressionism",
   "words": "impressionist painting, visible broken brushstrokes, dappled light, soft edges, vibrant atmospheric color",
   "substyles": [
    {
     "id": "neo-impressionism",
     "label": "Neo-Impressionism",
     "words": "neo-impressionist pointillism, small dots of pure color, divisionist technique, luminous optical mixing"
    }
   ]
  },
  {
   "id": "tonalism",
   "label": "Tonalism",
   "words": "tonalist painting, a soft muted palette of grays and browns, misty dusk atmosphere, quiet contemplative mood",
   "substyles": [
    {
     "id": "atmospheric-tonalism",
     "label": "Atmospheric Tonalism",
     "words": "atmospheric tonalism, veils of mist and haze, soft glowing light, a near-monochrome palette, dreamy stillness"
    }
   ]
  },
  {
   "id": "expressionism",
   "label": "Expressionism",
   "words": "expressionist art, bold distorted forms, intense emotional color, energetic gestural marks",
   "substyles": [
    {
     "id": "fauvism",
     "label": "Fauvism",
     "words": "fauvist painting, wild unnatural pure color, flat bold areas, loose expressive brushwork"
    },
    {
     "id": "neo-expressionism",
     "label": "Neo-Expressionism",
     "words": "neo-expressionist painting, crude raw figures, thick violent brushwork, vivid clashing color"
    }
   ]
  },
  {
   "id": "abstract-expressionism",
   "label": "Abstract Expressionism",
   "words": "abstract expressionist action painting, large gestural brushstrokes, drips and splatters, raw energetic color",
   "substyles": [
    {
     "id": "color-field",
     "label": "Color Field Painting",
     "words": "color field painting, broad expanses of flat soaked color, soft edges, meditative calm"
    }
   ]
  },
  {
   "id": "surrealism",
   "label": "Surrealism",
   "words": "surrealist art, a dreamlike impossible scene, uncanny juxtapositions, the strange rendered precisely",
   "substyles": []
  },
  {
   "id": "abstract",
   "label": "Abstract",
   "words": "abstract art, bold geometric shapes, precise lines and flat planes of color, forms suggested rather than literal",
   "substyles": [
    {
     "id": "organic-abstraction",
     "label": "Organic Abstraction",
     "words": "organic abstraction, flowing biomorphic shapes, natural curves, soft layered color"
    },
    {
     "id": "lyrical-abstraction",
     "label": "Lyrical Abstraction",
     "words": "lyrical abstraction, loose poetic brushwork, luminous washes, free flowing color"
    }
   ]
  },
  {
   "id": "minimalism",
   "label": "Minimalism",
   "words": "minimalist illustration, simple clean shapes, a limited palette, generous negative space",
   "substyles": [
    {
     "id": "hard-edge-painting",
     "label": "Hard-Edge Minimalism",
     "words": "hard-edge minimalism, crisp sharp-edged shapes of flat color, high contrast, clean abrupt transitions"
    }
   ]
  },
  {
   "id": "art-nouveau",
   "label": "Art Nouveau",
   "words": "art nouveau illustration, flowing organic lines, ornamental floral borders, elegant decorative curves",
   "substyles": [
    {
     "id": "glasgow-style",
     "label": "Glasgow Style",
     "words": "Glasgow style, elongated vertical lines, stylized roses, a restrained palette of mauve and green, delicate geometric ornament"
    }
   ]
  },
  {
   "id": "art-deco",
   "label": "Art Deco",
   "words": "art deco style, bold geometric symmetry, sleek stylized forms, gold and black accents, 1920s glamour",
   "substyles": [
    {
     "id": "streamline-moderne",
     "label": "Streamline Moderne",
     "words": "streamline moderne, sleek aerodynamic curves, horizontal speed lines, polished chrome, nautical motifs"
    },
    {
     "id": "egyptian-revival",
     "label": "Egyptian Revival Art Deco",
     "words": "Egyptian revival art deco, lotus and scarab motifs, pyramids, gold, lapis and black, symmetrical stylized figures"
    }
   ]
  },
  {
   "id": "classical",
   "label": "Classical",
   "words": "classical academic painting, idealized figures, balanced composition, chiaroscuro, old master technique",
   "substyles": [
    {
     "id": "rococo",
     "label": "Rococo",
     "words": "Rococo painting, playful pastel colors, light airy brushwork, ornate scrolls, romantic garden scenes"
    }
   ]
  },
  {
   "id": "cartoon",
   "label": "Cartoon",
   "words": "cartoon illustration, friendly exaggerated characters, bold clean outlines, bright flat colors",
   "substyles": [
    {
     "id": "rubber-hose",
     "label": "Rubber Hose",
     "words": "rubber hose cartoon, 1930s animation, noodle limbs, pie-cut eyes, white gloves, muted vintage color"
    },
    {
     "id": "storybook-cartoon",
     "label": "Storybook Cartoon",
     "words": "storybook cartoon illustration, gentle rounded characters, soft textured color, cozy picture-book charm"
    }
   ]
  },
  {
   "id": "anime",
   "label": "Anime & Manga",
   "words": "anime and manga style, expressive large eyes, clean cel-shaded line art, vibrant colors",
   "substyles": [
    {
     "id": "retro-anime",
     "label": "Retro Anime",
     "words": "retro anime, 1980s and 1990s hand-painted cel animation, soft film grain, muted colors, detailed painted backgrounds"
    },
    {
     "id": "chibi",
     "label": "Chibi",
     "words": "chibi anime style, tiny super-deformed characters, oversized heads, cute simple features"
    },
    {
     "id": "painterly-anime",
     "label": "Painterly Anime",
     "words": "painterly anime style, soft hand-painted backgrounds, lush natural light, gentle watercolor-like color, storybook atmosphere"
    },
    {
     "id": "realistic-anime",
     "label": "Realistic Anime",
     "words": "realistic anime style, realistic proportions and anatomy, refined linework, detailed shading, cinematic lighting"
    }
   ]
  },
  {
   "id": "comic-book",
   "label": "Comic Book",
   "words": "modern comic book art, bold clean inks, dynamic poses, digital coloring, cinematic lighting",
   "substyles": [
    {
     "id": "golden-age",
     "label": "Golden Age",
     "words": "golden age comic book art, 1940s, simple bold inks, flat primary colors, halftone dots, heroic poses"
    },
    {
     "id": "silver-age",
     "label": "Silver Age",
     "words": "silver age comic book art, 1960s, clean confident inking, bright flat color, dramatic dynamic panels"
    },
    {
     "id": "european-comics",
     "label": "European Comics",
     "words": "European bande dessinée, ligne claire, clean even outlines, flat clear colors, detailed backgrounds"
    }
   ]
  }
 ],
 "mediums": [
  {
   "id": "watercolor",
   "label": "Watercolor",
   "words": "watercolor, soft translucent washes, visible paper grain, loose wet edges"
  },
  {
   "id": "oil-painting",
   "label": "Oil Painting",
   "words": "oil painting, rich impasto brushwork, layered glazes, canvas texture"
  },
  {
   "id": "acrylic",
   "label": "Acrylic",
   "words": "acrylic painting, opaque vivid color, crisp brushstrokes, matte finish"
  },
  {
   "id": "pencil",
   "label": "Pencil",
   "words": "graphite pencil drawing, fine hatching, delicate shading on paper"
  },
  {
   "id": "charcoal",
   "label": "Charcoal",
   "words": "charcoal drawing, smudged tonal shading, deep blacks, expressive strokes on textured paper"
  },
  {
   "id": "pen-ink",
   "label": "Pen & Ink",
   "words": "pen and ink drawing, confident black linework, cross-hatching, high contrast"
  },
  {
   "id": "pastel",
   "label": "Pastel",
   "words": "soft pastel drawing, chalky texture, softly blended color, visible paper tooth"
  },
  {
   "id": "engraving",
   "label": "Engraving",
   "words": "copperplate engraving, dense fine parallel lines, etched texture"
  },
  {
   "id": "woodcut",
   "label": "Woodcut",
   "words": "woodcut print, bold carved lines, high-contrast black and white, rough wood grain"
  },
  {
   "id": "collage",
   "label": "Collage",
   "words": "paper collage, cut and torn paper pieces, layered textures, mixed media"
  }
 ],
 "themes": [
  {
   "label": "Styles & Periods",
   "options": [
    {
     "id": "greek-roman",
     "label": "Greek & Roman"
    },
    {
     "id": "byzantine",
     "label": "Byzantine"
    },
    {
     "id": "romanesque",
     "label": "Romanesque"
    },
    {
     "id": "gothic",
     "label": "Gothic"
    },
    {
     "id": "renaissance",
     "label": "Renaissance"
    },
    {
     "id": "baroque",
     "label": "Baroque"
    },
    {
     "id": "rococo",
     "label": "Rococo"
    },
    {
     "id": "neoclassical",
     "label": "Neoclassical"
    },
    {
     "id": "victorian",
     "label": "Victorian"
    },
    {
     "id": "arts-and-crafts",
     "label": "Arts and Crafts"
    },
    {
     "id": "art-nouveau",
     "label": "Art Nouveau"
    },
    {
     "id": "art-deco",
     "label": "Art Deco"
    },
    {
     "id": "modernist",
     "label": "Modernist"
    },
    {
     "id": "mid-century-modern",
     "label": "Mid-Century Modern"
    },
    {
     "id": "psychedelic",
     "label": "Psychedelic"
    }
   ]
  },
  {
   "label": "Cultures",
   "options": [
    {
     "id": "african",
     "label": "African"
    },
    {
     "id": "egyptian",
     "label": "Ancient Egyptian"
    },
    {
     "id": "ancient-near-east",
     "label": "Ancient Near East"
    },
    {
     "id": "celtic",
     "label": "Celtic & Insular"
    },
    {
     "id": "east-asian",
     "label": "East Asian"
    },
    {
     "id": "islamic",
     "label": "Islamic"
    },
    {
     "id": "mesoamerican",
     "label": "Mesoamerican"
    },
    {
     "id": "native-american",
     "label": "Native American"
    },
    {
     "id": "norse",
     "label": "Norse & Viking"
    },
    {
     "id": "oceanic",
     "label": "Oceanic"
    },
    {
     "id": "slavic",
     "label": "Slavic"
    },
    {
     "id": "south-asian",
     "label": "South Asian"
    }
   ]
  },
  {
   "label": "Genres",
   "options": [
    {
     "id": "fantasy",
     "label": "Fantasy"
    },
    {
     "id": "folk-art",
     "label": "Folk Art"
    },
    {
     "id": "mythological",
     "label": "Mythological"
    },
    {
     "id": "occult",
     "label": "Occult"
    },
    {
     "id": "science-fiction",
     "label": "Science Fiction"
    },
    {
     "id": "steampunk",
     "label": "Steampunk"
    }
   ]
  }
 ]
};
