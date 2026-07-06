use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    veritas::{
        constants::{REPUTATION_LOSS, REPUTATION_START, REPUTATION_WIN, SELLER_SEED},
        state::{ConsensusMode, RequestStatus, SellerAccount, VerificationRequest},
    },
};

struct Harness {
    svm: LiteSVM,
    program_id: Pubkey,
    coordinator: Keypair,
    config: Pubkey,
    stake_mint: Pubkey,
}

impl Harness {
    fn new() -> Self {
        let program_id = veritas::id();
        let coordinator = Keypair::new();
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/veritas.so"));
        svm.add_program(program_id, bytes).unwrap();
        svm.airdrop(&coordinator.pubkey(), 10_000_000_000).unwrap();

        // USDC stand-in mint (6 decimals), authority = coordinator.
        let stake_mint = litesvm_token::CreateMint::new(&mut svm, &coordinator)
            .decimals(6)
            .send()
            .unwrap();

        let config = Pubkey::find_program_address(&[b"config"], &program_id).0;
        let mut h = Harness { svm, program_id, coordinator, config, stake_mint };
        // fee 200 bps, tolerance 100 bps (1%)
        let ix = h.ix(
            veritas::instruction::Initialize {
                coordinator: h.coordinator.pubkey(),
                stake_mint: h.stake_mint,
                fee_bps: 200,
                tolerance_bps: 100,
            }
            .data(),
            veritas::accounts::Initialize {
                payer: h.coordinator.pubkey(),
                config: h.config,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        h.send(&[ix], &[]).unwrap();
        h
    }

    fn ix(&self, data: Vec<u8>, accounts: Vec<anchor_lang::solana_program::instruction::AccountMeta>) -> Instruction {
        Instruction::new_with_bytes(self.program_id, &data, accounts)
    }

    fn send(
        &mut self,
        ixs: &[Instruction],
        extra_signers: &[&Keypair],
    ) -> Result<(), Box<dyn std::error::Error>> {
        let msg = Message::new_with_blockhash(
            ixs,
            Some(&self.coordinator.pubkey()),
            &self.svm.latest_blockhash(),
        );
        let mut signers: Vec<&Keypair> = vec![&self.coordinator];
        signers.extend_from_slice(extra_signers);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers)?;
        self.svm
            .send_transaction(tx)
            .map_err(|e| format!("tx failed: {:?}", e.err))?;
        Ok(())
    }

    fn register_seller(&mut self, name: &str) -> (Keypair, Pubkey) {
        let owner = Keypair::new();
        self.svm.airdrop(&owner.pubkey(), 1_000_000_000).unwrap();
        let seller_pda = Pubkey::find_program_address(
            &[SELLER_SEED, owner.pubkey().as_ref()],
            &self.program_id,
        )
        .0;
        let ix = self.ix(
            veritas::instruction::RegisterSeller { name: name.to_string() }.data(),
            veritas::accounts::RegisterSeller {
                owner: owner.pubkey(),
                seller: seller_pda,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(&[ix], &[&owner]).unwrap();
        (owner, seller_pda)
    }

    fn request_pda(&self, query_id: [u8; 32]) -> Pubkey {
        Pubkey::find_program_address(&[b"vreq", query_id.as_ref()], &self.program_id).0
    }

    fn open_request(&mut self, query_id: [u8; 32], mode: ConsensusMode, k: u8) {
        let request = self.request_pda(query_id);
        let ix = self.ix(
            veritas::instruction::OpenRequest {
                query_id,
                buyer_ref: [7u8; 32],
                mode,
                k,
            }
            .data(),
            veritas::accounts::OpenRequest {
                coordinator: self.coordinator.pubkey(),
                config: self.config,
                request,
                system_program: system_program::ID,
            }
            .to_account_metas(None),
        );
        self.send(&[ix], &[]).unwrap();
    }

    fn submit(
        &mut self,
        query_id: [u8; 32],
        seller_owner: Pubkey,
        seller_pda: Pubkey,
        value: Vec<u8>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let request = self.request_pda(query_id);
        let ix = self.ix(
            veritas::instruction::SubmitResponse { query_id, seller_owner, value }.data(),
            veritas::accounts::SubmitResponse {
                coordinator: self.coordinator.pubkey(),
                config: self.config,
                request,
                seller: seller_pda,
            }
            .to_account_metas(None),
        );
        self.send(&[ix], &[])
    }

    fn finalize(&mut self, query_id: [u8; 32], seller_pdas: &[Pubkey]) {
        let request = self.request_pda(query_id);
        let mut metas = veritas::accounts::FinalizeConsensus {
            coordinator: self.coordinator.pubkey(),
            config: self.config,
            request,
        }
        .to_account_metas(None);
        for pda in seller_pdas {
            metas.push(anchor_lang::solana_program::instruction::AccountMeta::new(*pda, false));
        }
        let ix = self.ix(
            veritas::instruction::FinalizeConsensus { query_id }.data(),
            metas,
        );
        self.send(&[ix], &[]).unwrap();
    }

    fn get_request(&self, query_id: [u8; 32]) -> VerificationRequest {
        let acc = self.svm.get_account(&self.request_pda(query_id)).unwrap();
        VerificationRequest::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    fn get_seller(&self, pda: Pubkey) -> SellerAccount {
        let acc = self.svm.get_account(&pda).unwrap();
        SellerAccount::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }
}

fn num(v: i64) -> Vec<u8> {
    v.to_le_bytes().to_vec()
}

/// SPL token account balance: u64 LE at offset 64 (layout is frozen).
fn token_amount(h: &Harness, account: &Pubkey) -> u64 {
    let data = h.svm.get_account(account).unwrap().data;
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

#[test]
fn numeric_round_catches_the_liar() {
    let mut h = Harness::new();
    let (o1, s1) = h.register_seller("honest-1");
    let (o2, s2) = h.register_seller("honest-2");
    let (o3, s3) = h.register_seller("liar");

    // Sanity: registration state
    let seller = h.get_seller(s1);
    assert_eq!(seller.owner, o1.pubkey());
    assert_eq!(seller.reputation, REPUTATION_START);

    let qid = [1u8; 32];
    h.open_request(qid, ConsensusMode::Numeric, 3);

    // BTC/USD in micro-USD: two honest ~50_000, liar says 55_000 (>1% off)
    h.submit(qid, o1.pubkey(), s1, num(50_000_000_000)).unwrap();
    h.submit(qid, o2.pubkey(), s2, num(50_100_000_000)).unwrap();
    h.submit(qid, o3.pubkey(), s3, num(55_000_000_000)).unwrap();

    h.finalize(qid, &[s1, s2, s3]);

    let req = h.get_request(qid);
    assert_eq!(req.status, RequestStatus::Settled);
    assert_eq!(req.winners_bitmap, 0b011, "sellers 0 and 1 win; liar (bit 2) loses");
    // Truth = median = 50_100_000_000
    assert_eq!(
        i64::from_le_bytes(req.verdict[..8].try_into().unwrap()),
        50_100_000_000
    );

    // Reputation: winners +WIN, liar -LOSS; counters updated
    let w = h.get_seller(s1);
    assert_eq!(w.reputation, REPUTATION_START + REPUTATION_WIN);
    assert_eq!((w.served, w.matched, w.outliers), (1, 1, 0));
    let l = h.get_seller(s3);
    assert_eq!(l.reputation, REPUTATION_START - REPUTATION_LOSS);
    assert_eq!((l.served, l.matched, l.outliers), (1, 0, 1));
}

#[test]
fn hash_round_majority_wins() {
    let mut h = Harness::new();
    let (o1, s1) = h.register_seller("a");
    let (o2, s2) = h.register_seller("b");
    let (o3, s3) = h.register_seller("c");

    let qid = [2u8; 32];
    h.open_request(qid, ConsensusMode::Hash, 3);

    let truth = vec![0xAB; 32];
    h.submit(qid, o1.pubkey(), s1, truth.clone()).unwrap();
    h.submit(qid, o2.pubkey(), s2, truth.clone()).unwrap();
    h.submit(qid, o3.pubkey(), s3, vec![0xCD; 32]).unwrap();

    h.finalize(qid, &[s1, s2, s3]);

    let req = h.get_request(qid);
    assert_eq!(req.status, RequestStatus::Settled);
    assert_eq!(req.winners_bitmap, 0b011);
    assert_eq!(&req.verdict[..32], truth.as_slice());
}

#[test]
fn hash_round_without_majority_fails_everyone() {
    let mut h = Harness::new();
    let (o1, s1) = h.register_seller("a");
    let (o2, s2) = h.register_seller("b");

    let qid = [3u8; 32];
    h.open_request(qid, ConsensusMode::Hash, 2);
    h.submit(qid, o1.pubkey(), s1, vec![1; 32]).unwrap();
    h.submit(qid, o2.pubkey(), s2, vec![2; 32]).unwrap();
    h.finalize(qid, &[s1, s2]);

    let req = h.get_request(qid);
    assert_eq!(req.status, RequestStatus::Failed);
    assert_eq!(req.winners_bitmap, 0);
    // Nobody is paid; both take the outlier hit.
    assert_eq!(h.get_seller(s1).outliers, 1);
}

#[test]
fn guards_reject_bad_submissions() {
    let mut h = Harness::new();
    let (o1, s1) = h.register_seller("a");
    let (_o2, _s2) = h.register_seller("b");

    let qid = [4u8; 32];
    h.open_request(qid, ConsensusMode::Numeric, 2);
    h.submit(qid, o1.pubkey(), s1, num(42)).unwrap();

    // Duplicate seller rejected
    assert!(h.submit(qid, o1.pubkey(), s1, num(43)).is_err());
    // Oversized value rejected (65 > 64)
    let (o3, s3) = h.register_seller("c");
    assert!(h.submit(qid, o3.pubkey(), s3, vec![0; 65]).is_err());
    // Numeric value shorter than 8 bytes rejected
    assert!(h.submit(qid, o3.pubkey(), s3, vec![0; 4]).is_err());
}

#[test]
fn close_request_reclaims_rent() {
    let mut h = Harness::new();
    let (o1, s1) = h.register_seller("a");
    let (o2, s2) = h.register_seller("b");

    let qid = [5u8; 32];
    h.open_request(qid, ConsensusMode::Numeric, 2);

    let request_pda = h.request_pda(qid);

    // Cannot close while open
    let close_ix = h.ix(
        veritas::instruction::CloseRequest { query_id: qid }.data(),
        veritas::accounts::CloseRequest {
            coordinator: h.coordinator.pubkey(),
            config: h.config,
            request: request_pda,
        }
        .to_account_metas(None),
    );
    assert!(h.send(&[close_ix.clone()], &[]).is_err());

    h.submit(qid, o1.pubkey(), s1, num(100_000_000)).unwrap();
    h.submit(qid, o2.pubkey(), s2, num(100_000_000)).unwrap();
    h.finalize(qid, &[s1, s2]);

    // New blockhash so the retried close isn't deduped as AlreadyProcessed.
    h.svm.expire_blockhash();

    let before = h.svm.get_balance(&h.coordinator.pubkey()).unwrap();
    h.send(&[close_ix], &[]).unwrap();
    let after = h.svm.get_balance(&h.coordinator.pubkey()).unwrap();
    assert!(after > before, "rent reclaimed to coordinator");
    assert!(h.svm.get_account(&request_pda).is_none() || h.svm.get_account(&request_pda).unwrap().data.is_empty());
}

#[test]
fn stake_lifecycle_with_slash() {
    let mut h = Harness::new();
    let (o1, s1) = h.register_seller("staker");
    let (o2, s2) = h.register_seller("honest");

    // Fund the staker with 100 USDC (6 decimals) in an ATA.
    let owner_ata = litesvm_token::CreateAssociatedTokenAccount::new(
        &mut h.svm,
        &h.coordinator,
        &h.stake_mint,
    )
    .owner(&o1.pubkey())
    .send()
    .unwrap();
    litesvm_token::MintTo::new(&mut h.svm, &h.coordinator, &h.stake_mint, &owner_ata, 100_000_000)
        .send()
        .unwrap();

    let custody =
        Pubkey::find_program_address(&[b"stake", o1.pubkey().as_ref()], &h.program_id).0;

    // add_stake 50 USDC
    let ix = h.ix(
        veritas::instruction::AddStake { amount: 50_000_000 }.data(),
        veritas::accounts::AddStake {
            owner: o1.pubkey(),
            seller: s1,
            config: h.config,
            stake_mint: h.stake_mint,
            owner_token: owner_ata,
            custody,
            token_program: anchor_spl::token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    h.send(&[ix], &[&o1]).unwrap();

    assert_eq!(h.get_seller(s1).stake, 50_000_000);
    assert_eq!(token_amount(&h, &custody), 50_000_000);

    // Staker loses a round → 10% slash (50 → 45 USDC ledger stake).
    let qid = [9u8; 32];
    h.open_request(qid, ConsensusMode::Hash, 2);
    h.submit(qid, o2.pubkey(), s2, vec![1; 32]).unwrap();
    // Need a majority: register a third honest seller.
    let (o3, s3) = h.register_seller("honest-2");
    h.submit(qid, o3.pubkey(), s3, vec![1; 32]).unwrap();
    // (k=2 request is full; staker lies on a fresh k=3 round instead)
    let qid2 = [10u8; 32];
    h.open_request(qid2, ConsensusMode::Hash, 3);
    h.submit(qid2, o2.pubkey(), s2, vec![1; 32]).unwrap();
    h.submit(qid2, o3.pubkey(), s3, vec![1; 32]).unwrap();
    h.submit(qid2, o1.pubkey(), s1, vec![2; 32]).unwrap(); // staker lies
    h.finalize(qid2, &[s2, s3, s1]);

    assert_eq!(h.get_seller(s1).stake, 45_000_000, "10% slashed");

    // Withdraw ledger stake (45) succeeds; withdrawing more fails.
    let wd = |amount: u64, h: &Harness| {
        h.ix(
            veritas::instruction::WithdrawStake { amount }.data(),
            veritas::accounts::WithdrawStake {
                owner: o1.pubkey(),
                seller: s1,
                config: h.config,
                owner_token: owner_ata,
                custody,
                token_program: anchor_spl::token::ID,
            }
            .to_account_metas(None),
        )
    };
    let too_much = wd(50_000_000, &h);
    assert!(h.send(&[too_much], &[&o1]).is_err(), "cannot withdraw slashed funds");
    let ok = wd(45_000_000, &h);
    h.send(&[ok], &[&o1]).unwrap();
    assert_eq!(h.get_seller(s1).stake, 0);

    // 5 USDC of slashed funds remain in custody = protocol treasury.
    assert_eq!(token_amount(&h, &custody), 5_000_000);
}

#[test]
fn only_coordinator_can_open() {
    let mut h = Harness::new();
    let mallory = Keypair::new();
    h.svm.airdrop(&mallory.pubkey(), 1_000_000_000).unwrap();

    let qid = [6u8; 32];
    let request = h.request_pda(qid);
    let ix = Instruction::new_with_bytes(
        h.program_id,
        &veritas::instruction::OpenRequest {
            query_id: qid,
            buyer_ref: [0u8; 32],
            mode: ConsensusMode::Numeric,
            k: 3,
        }
        .data(),
        veritas::accounts::OpenRequest {
            coordinator: mallory.pubkey(), // not the real coordinator
            config: h.config,
            request,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let msg = Message::new_with_blockhash(&[ix], Some(&mallory.pubkey()), &h.svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&mallory]).unwrap();
    assert!(h.svm.send_transaction(tx).is_err(), "unauthorized open must fail");
}
