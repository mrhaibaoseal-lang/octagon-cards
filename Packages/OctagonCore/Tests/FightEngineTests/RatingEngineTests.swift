import Foundation
import Testing
@testable import FightEngine

@Suite("P1-2 RatingEngine (Bayesian Shrinkage + MMA Elo + Targeted Deltas)")
struct RatingEngineTests {
    @Test("Empirical Bayes shrinkage pulls 1-0 newcomer toward UFC prior")
    func bayesianShrinkagePreventsNewcomerOutliers() {
        let newcomer = RawFighterProfile(
            id: "newcomer-ko",
            name: "Newcomer KO",
            weightClass: "Lightweight",
            wins: 1,
            losses: 0,
            draws: 0,
            careerStats: CareerRawStats(
                slpm: 9.2,
                strAccPct: 78.0,
                kdAvg: 2.4,
                koWinPct: 100.0
            )
        )
        let veteran = RawFighterProfile(
            id: "vet-ko",
            name: "Veteran KO",
            weightClass: "Lightweight",
            wins: 22,
            losses: 3,
            draws: 0,
            careerStats: CareerRawStats(
                slpm: 6.0,
                strAccPct: 58.0,
                kdAvg: 1.2,
                koWinPct: 75.0
            )
        )

        let newAttrs = RatingEngine.computeBaseAttributes(for: newcomer)
        let vetAttrs = RatingEngine.computeBaseAttributes(for: veteran)

        #expect(FighterAttributes.range.contains(newAttrs.power))
        #expect(newAttrs.power <= 94)
        #expect(vetAttrs.power >= 75)
        #expect(newAttrs.allValues.allSatisfy { (0...100).contains($0) })
    }

    @Test("Chronological MMA Elo and KO/TKO targeted attribute delta buff winner Power and nerf loser Chin")
    func koBoutAppliesTargetedDeltasAndElo() {
        let striker = RawFighterProfile(
            id: "ilia-topuria",
            name: "Ilia Topuria",
            weightClass: "Featherweight",
            wins: 16,
            losses: 0,
            draws: 0,
            careerStats: CareerRawStats(slpm: 4.6, strAccPct: 47.0, kdAvg: 0.85, koWinPct: 62.0),
            bouts: [
                BoutStatRecord(
                    boutDate: "Oct. 26, 2024",
                    isoDate: "2024-10-26",
                    headline: "Topuria vs Holloway",
                    opponentId: "max-holloway",
                    opponentName: "Max Holloway",
                    result: "W",
                    method: "KO/TKO",
                    round: 3,
                    time: "1:34"
                )
            ]
        )

        let ironChinVet = RawFighterProfile(
            id: "max-holloway",
            name: "Max Holloway",
            weightClass: "Featherweight",
            wins: 26,
            losses: 8,
            draws: 0,
            careerStats: CareerRawStats(
                slpm: 7.1,
                strAccPct: 48.0,
                sapm: 4.7,
                strDefPct: 59.0,
                kdAvg: 0.35,
                avgFightTimeMinutes: 15.0,
                koWinPct: 46.0
            ),
            bouts: [
                BoutStatRecord(
                    boutDate: "Oct. 26, 2024",
                    isoDate: "2024-10-26",
                    headline: "Topuria vs Holloway",
                    opponentId: "ilia-topuria",
                    opponentName: "Ilia Topuria",
                    result: "L",
                    method: "KO/TKO",
                    round: 3,
                    time: "1:34"
                )
            ]
        )

        let baseStriker = RatingEngine.computeBaseAttributes(for: striker)
        let baseVet = RatingEngine.computeBaseAttributes(for: ironChinVet)
        let rated = RatingEngine.calculateRosterRatings(profiles: [striker, ironChinVet])

        let ratedStriker = rated.first { $0.id == "ilia-topuria" }!
        let ratedVet = rated.first { $0.id == "max-holloway" }!

        #expect(ratedStriker.attributes.power > baseStriker.power)
        #expect(ratedStriker.attributes.accuracy >= baseStriker.accuracy)
        #expect(ratedVet.attributes.chin < baseVet.chin)
        #expect(ratedVet.attributes.strikingDefense < baseVet.strikingDefense)
        #expect(ratedStriker.lastFightPatchNote?.contains("KO/TKO") == true)
        #expect((2...4).contains(ratedStriker.traits.count))
        #expect((2...4).contains(ratedVet.traits.count))
    }

    @Test("Submission win buffs submission & clinch; repeated KO losses assign glassChin trait")
    func submissionAndGlassChinTraitRules() {
        let grappler = RawFighterProfile(
            id: "islam-makhachev",
            name: "Islam Makhachev",
            weightClass: "Lightweight",
            stance: .southpaw,
            wins: 27,
            losses: 1,
            draws: 0,
            careerStats: CareerRawStats(
                slpm: 2.6,
                strAccPct: 59.0,
                sapm: 1.5,
                strDefPct: 61.0,
                tdAvg: 3.2,
                tdAccPct: 54.0,
                tdDefPct: 91.0,
                subAvg: 1.1,
                clinchStrPct: 19.0,
                groundStrPct: 24.0,
                subWinPct: 48.0
            ),
            bouts: [
                BoutStatRecord(
                    boutDate: "Jan. 18, 2025",
                    isoDate: "2025-01-18",
                    headline: "Makhachev vs Moicano",
                    opponentId: "renato-moicano",
                    opponentName: "Renato Moicano",
                    result: "W",
                    method: "SUB",
                    round: 1,
                    time: "4:05"
                )
            ]
        )

        let chinCompromised = RawFighterProfile(
            id: "chin-worn",
            name: "Chin Worn Vet",
            weightClass: "Lightweight",
            wins: 14,
            losses: 6,
            draws: 0,
            careerStats: CareerRawStats(sapm: 4.8, strDefPct: 48.0),
            bouts: [
                BoutStatRecord(
                    boutDate: "Jan. 01, 2024",
                    isoDate: "2024-01-01",
                    headline: "Bout 1",
                    opponentId: "opp-1",
                    opponentName: "Opp 1",
                    result: "L",
                    method: "KO/TKO",
                    round: 1
                ),
                BoutStatRecord(
                    boutDate: "Jun. 01, 2024",
                    isoDate: "2024-06-01",
                    headline: "Bout 2",
                    opponentId: "opp-2",
                    opponentName: "Opp 2",
                    result: "L",
                    method: "KO/TKO",
                    round: 2
                ),
            ]
        )

        let baseGrappler = RatingEngine.computeBaseAttributes(for: grappler)
        let rated = RatingEngine.calculateRosterRatings(profiles: [grappler, chinCompromised])
        let outGrappler = rated.first { $0.id == "islam-makhachev" }!
        let outWorn = rated.first { $0.id == "chin-worn" }!

        #expect(outGrappler.attributes.submission > baseGrappler.submission)
        #expect(outGrappler.attributes.clinch >= baseGrappler.clinch)
        #expect(outGrappler.has(.blackBeltBJJ) || outGrappler.has(.smother))
        #expect(outWorn.has(.glassChin))
        #expect(!outWorn.has(.ironChin))
    }

    @Test("loadFighters decodes exported fighters.json schema cleanly")
    func decodeFightersJSONSchema() throws {
        let sampleJSON = """
        [
          {
            "id": "islam-makhachev",
            "name": "Islam Makhachev",
            "nickname": null,
            "weightClass": "Welterweight",
            "record": "29-1-0",
            "stance": "southpaw",
            "eloRating": 1758,
            "overallRating": 90,
            "fullBodyImageUrl": "https://ufc.com/images/styles/athlete_bio_full_body/s3/2025-01/7/MAKHACHEV_ISLAM_L_BELT_01-18.png",
            "headshotImageUrl": "https://ufc.com/images/styles/event_results_athlete_headshot/s3/2025-01/7/MAKHACHEV_ISLAM_BELT_01-18.png",
            "attributes": {
              "power": 70, "speed": 65, "accuracy": 84, "strikingDefense": 84, "chin": 88,
              "cardio": 98, "takedown": 81, "takedownDefense": 90, "submission": 87, "clinch": 98
            },
            "traits": ["ironChin", "blackBeltBJJ", "smother", "gasTank"],
            "lastFightPatchNote": "W vs Machado Garry (U-DEC R5): Elo 1747→1758 (+11)"
          }
        ]
        """.data(using: .utf8)!

        let fighters = try RatingEngine.loadFighters(from: sampleJSON)
        #expect(fighters.count == 1)
        #expect(fighters[0].id == "islam-makhachev")
        #expect(fighters[0].stance == .southpaw)
        #expect(fighters[0].eloRating == 1758)
        #expect(fighters[0].attributes.cardio == 98)
        #expect(fighters[0].has(.smother))
    }

    @Test("RealUFCRoster contains 32 real UFC fighters with valid attributes, traits, and cutout URLs")
    func realUFCRosterIntegrity() {
        #expect(RealUFCRoster.all.count == 32)
        for fighter in RealUFCRoster.all {
            #expect(!fighter.id.isEmpty)
            #expect(!fighter.name.isEmpty)
            #expect(fighter.attributes.allValues.allSatisfy { (0...100).contains($0) })
            #expect((2...4).contains(fighter.traits.count))
            #expect(fighter.fullBodyImageUrl != nil)
            #expect(fighter.eloRating != nil)
        }
        #expect(RealUFCRoster.fighter(id: "islam-makhachev")?.stance == .southpaw)
        #expect(RealUFCRoster.fighter(id: "ilia-topuria")?.has(.onePunch) == true)
    }
}
