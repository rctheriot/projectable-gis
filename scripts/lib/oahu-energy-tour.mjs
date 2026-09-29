/**
 * The narrated tour for "Oahu Energy Goals": solar, and the land it competes for.
 *
 * DRAFT. The wording needs review before it is recorded or shown to the public.
 *
 * Every figure is computed from this story's own data or the USGS elevation model,
 * not remembered. Where each comes from:
 *
 *   - 83% fossil in 2016; 0% in 2045; 43% utility PV and 37% distributed (rooftop)
 *     in 2045 under E3 -- data/generation.csv, share of total generation.
 *   - ~105 km² of solar land -- area of every parcel in layers/solar.json (the NREL
 *     technical potential), 104.9 km².
 *   - ~42 km², ~10,400 acres, ~40% of that land built by 2045 under E3 -- area of
 *     parcels whose buildout rank falls inside the 2045 E3 PV budget (generation +
 *     curtailment): 42.3 km², 10,449 acres, 40.3%. (The legend's "% built" is a
 *     share of solar *energy*, 42%, not of land.)
 *   - Nearly nine in ten acres on rated farmland, almost half Class B -- parcel
 *     centres tested against the Land Study Bureau layer: 88.8% in a rated class,
 *     45.5% in Class B, 0.1% in Class A.
 *   - Over a third of the island steeper than the threshold -- slope from 3DEP at
 *     the base map's resolution: 35.6% of 1,557 km² steeper than 20°. (Printed by
 *     `npm run prepare-story`; changes with the threshold.)
 *   - Solar sites almost all on flat ground -- slope sampled at every solar parcel
 *     vertex: median 3°, 90% under 8.6°, 1.2% steeper than 20°.
 *   - 100% renewable electricity by 2045, the first state to set it in law --
 *     Hawaiʻi Act 97 (2015).
 *
 * "More than a third of Oʻahu" holds for 20°. If the threshold changes, check the
 * share `prepare-story` prints for the too-steep layer and update that sentence.
 *
 * @param {{ maxSlopeDegrees: number }} options
 */
export function oahuEnergyTour({ maxSlopeDegrees }) {
  return {
    title: 'Sun, Land and the 2045 Goal',
    draft: true,
    steps: [
      {
        id: 'intro',
        title: 'Oʻahu, 2045',
        narration:
          'This is Oʻahu, home to about two in every three people in Hawaiʻi. In 2015, Hawaiʻi became the first state to set a law requiring all of its electricity to come from renewable sources, by 2045. This is the story of what that goal asks of the land.',
        view: { year: 2016, scenario: 'e3', layers: [] },
      },
      {
        id: 'baseline',
        title: 'Where we started',
        narration:
          'In 2016, eighty-three percent of the island’s electricity came from fossil fuel shipped in from overseas. The teal patches are the renewable plants already running, and the yellow-green lines are the transmission grid that any new power has to reach.',
        view: { year: 2016, scenario: 'e3', layers: ['existing-re', 'transmission'] },
      },
      {
        id: 'resource',
        title: 'The solar resource',
        narration:
          'Sunlight is the island’s largest energy resource. The white shows land a national laboratory study found suitable for utility-scale solar: about one hundred and five square kilometres of it.',
        view: { year: 2016, scenario: 'e3', layers: ['solar'] },
      },
      {
        id: 'buildout',
        title: 'Building toward 2045',
        narration:
          'Watch the years pass. In this scenario, solar farms, in orange, fill the sunniest sites first. By 2045, fossil fuel is gone, and utility-scale solar supplies about forty-three percent of the island’s power.',
        view: { year: 2016, scenario: 'e3', layers: ['solar'] },
        sweepTo: 2045,
      },
      {
        id: 'land',
        title: 'Ten thousand acres',
        narration:
          'That takes land. The solid orange covers about forty-two square kilometres, more than ten thousand acres, which is forty percent of all the suitable land the study found.',
        view: { year: 2045, scenario: 'e3', layers: ['solar'] },
      },
      {
        id: 'farmland',
        title: 'The same land as the farms',
        narration:
          'Now the farmland, rated by the Land Study Bureau, with darker green the most productive. Nearly nine in ten acres of the solar land is rated agricultural land, and almost half of it is Class B, among the best soil on the island.',
        view: { year: 2045, scenario: 'e3', layers: ['agriculture', 'solar'] },
      },
      {
        id: 'slope',
        title: 'Why the flat land',
        narration:
          'Solar and farming want the same thing: flat ground. This is the slope of the island, dark where it is flat and bright where it is steep. The Waiʻanae and Koʻolau ranges rise sharply on either side of the central plain.',
        view: { year: 2045, scenario: 'e3', layers: ['slope'] },
      },
      {
        id: 'too-steep',
        title: 'Too steep to build',
        narration: `Hatched in red is everything steeper than ${maxSlopeDegrees} degrees, too steep for rows of solar panels. That is more than a third of Oʻahu. The study’s solar sites sit almost entirely on the flat land that is left.`,
        view: { year: 2045, scenario: 'e3', layers: ['too-steep', 'solar'] },
      },
      {
        id: 'constraints',
        title: 'What remains',
        narration:
          'Set aside the steep ground, the parks, and the government and military land across central Oʻahu, and the flat land that remains is wanted by farms, by homes, and by power plants, all at once.',
        view: { year: 2045, scenario: 'e3', layers: ['too-steep', 'parks', 'government', 'solar'] },
      },
      {
        id: 'rooftops',
        title: 'Power without new land',
        narration:
          'That is why rooftops matter. In this scenario, rooftop and other small-scale solar supplies about thirty-seven percent of the island’s electricity by 2045, on land that is already built on.',
        view: { year: 2045, scenario: 'e3', layers: ['der'] },
      },
      {
        id: 'close',
        title: 'Every path is a choice about land',
        narration:
          'Every path to 2045 is a choice about how this island uses its land. Turn the pucks to explore the other scenarios, and see how the map changes.',
        view: { year: 2045, scenario: 'e3', layers: ['agriculture', 'too-steep', 'solar'] },
      },
    ],
  };
}
