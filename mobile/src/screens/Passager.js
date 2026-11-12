import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, Alert } from 'react-native';
import { api } from '../api';
import { C, STATUTS, ORDRE, heure, usd } from '../theme';
import { Carte, H, T, Muted, Bouton, Erreur, Pill, Onglets, EnTete } from '../ui';
import Radar from './Radar';
import Reclamation from './Reclamation';

export default function Passager({ passager, initial, quitter }) {
  const [onglet, setOnglet] = useState('bagages');
  const [d, setD] = useState(initial);
  const [err, setErr] = useState('');
  const [rafr, setRafr] = useState(false);

  const charger = useCallback(async () => {
    try { setD(await api('GET', `/api/suivi/${encodeURIComponent(passager.pnr)}?nom=${encodeURIComponent(passager.nom)}`)); setErr(''); }
    catch (e) { setErr(e.message); }
  }, [passager]);
  useEffect(() => { const i = setInterval(charger, 8000); return () => clearInterval(i); }, [charger]); // mise à jour quasi temps réel

  const mesBagages = d ? [{ numeroVol: d.vol.numero, depart: d.vol.depart, arrivee: d.vol.arrivee, nb: d.bagages.filter((b) => ['CHARGE', 'TRANSIT'].includes(b.statut)).length }] : [];

  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      <EnTete titre={d?.nom ?? 'Mon voyage'} sous={d ? `Réservation ${d.pnr} · ${d.vol.numero} ${d.vol.depart}→${d.vol.arrivee}` : ''} onQuitter={quitter} />
      <View style={{ flex: 1 }}>
        {onglet === 'bagages' ? <Bagages d={d} err={err} rafr={rafr} onRefresh={async () => { setRafr(true); await charger(); setRafr(false); }} passager={passager} recharger={charger} /> : null}
        {onglet === 'radar' ? <Radar passager={passager} mesBagages={mesBagages} volInitial={null} /> : null}
        {onglet === 'reclamation' ? <Reclamation passager={passager} vol={d?.vol} /> : null}
        {onglet === 'alertes' ? <Alertes d={d} /> : null}
      </View>
      <Onglets actif={onglet} onChange={setOnglet} onglets={[['bagages', '🧳', 'Bagages'], ['radar', '🛰️', 'Radar'], ['reclamation', '📝', 'Réclamation'], ['alertes', '🔔', 'Alertes']]} />
    </View>
  );
}

function Frise({ statut }) {
  const i = ORDRE.indexOf(statut);
  return (<View style={{ flexDirection: 'row', marginVertical: 8 }}>{ORDRE.map((k, j) => (
    <View key={k} style={{ flex: 1, height: 6, marginRight: 3, borderRadius: 3, backgroundColor: j <= i ? C.vert : C.bord }} />))}</View>);
}

function Bagages({ d, err, rafr, onRefresh, passager, recharger }) {
  const [att, setAtt] = useState(false); const [msg, setMsg] = useState('');
  if (!d) return <Erreur>{err || 'Chargement…'}</Erreur>;
  const ex = d.excedent;
  const payer = async () => {
    setAtt(true); setMsg('');
    try { await api('POST', `/api/suivi/${encodeURIComponent(d.pnr)}/payer`, { nom: passager.nom }); await recharger(); setMsg('Excédent réglé. Merci !'); }
    catch (e) { setMsg(e.message); }
    setAtt(false);
  };
  const envoyerLitige = async (code, type) => {
    try { await api('POST', `/api/suivi/${encodeURIComponent(d.pnr)}/litiges`, { nom: passager.nom, code, type, description: 'Signalé depuis l’application mobile' }); setMsg(`Problème signalé pour ${code}. Un agent va vous contacter.`); }
    catch (e) { setMsg(e.message); }
  };
  const litige = (code) => Alert.alert('Quel problème ?', code, [
    { text: 'Perdu', onPress: () => envoyerLitige(code, 'PERDU') },
    { text: 'Endommagé', onPress: () => envoyerLitige(code, 'ENDOMMAGE') },
    { text: 'Retardé', onPress: () => envoyerLitige(code, 'RETARDE') },
    { text: 'Annuler', style: 'cancel' },
  ]);
  return (
    <ScrollView contentContainerStyle={{ padding: 14 }} refreshControl={<RefreshControl refreshing={rafr} onRefresh={onRefresh} />}>
      <Erreur>{err}</Erreur>
      <Carte style={{ backgroundColor: C.bleu }}>
        <Text style={{ color: '#b8cbe0', fontSize: 12 }}>{d.classe} · vol {d.vol.numero}</Text>
        <Text style={{ color: '#fff', fontSize: 26, fontWeight: '800' }}>{d.vol.depart} → {d.vol.arrivee}</Text>
        <Text style={{ color: '#fff' }}>Départ {d.vol.heureDepart}{d.vol.libelleStatut ? ` · ${d.vol.libelleStatut}` : ''}{d.vol.retardMin ? ` (+${d.vol.retardMin} min)` : ''}</Text>
        <Text style={{ color: '#b8cbe0', marginTop: 6 }}>{d.bagages.length} bagage(s) · {ex.totalKg} kg · franchise {ex.franchiseKg} kg</Text>
      </Carte>
      {msg ? <Carte><T>{msg}</T></Carte> : null}
      {ex.kgRestants > 0 ? <Carte>
        <H>Excédent de bagage</H>
        <T>Vous dépassez la franchise de {ex.excesKg} kg. Au comptoir : {usd(ex.montantComptoirUsd)}. En ligne (−20 %) : {usd(ex.montantEnLigneUsd)}.</T>
        <Bouton titre={`Payer ${usd(ex.montantEnLigneUsd)} en ligne`} onPress={payer} chargement={att} couleur={C.vert} />
        <Muted style={{ marginTop: 6 }}>Paiement simulé dans cette démonstration.</Muted></Carte> : null}
      <H>Mes bagages · suivi en direct 🔴</H>
      {d.bagages.length === 0 ? <Carte><Muted>Aucun bagage associé pour le moment. Présentez-vous au comptoir Air Congo : l’agent émet l’étiquette de chaque bagage.</Muted></Carte> : null}
      {d.bagages.map((b) => (
        <Carte key={b.code}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: '700', color: C.bleu }}>{b.code}</Text>
            {b.niveau === 'VIP' ? <Pill texte="VIP · RFID" couleur={C.orange} /> : null}
          </View>
          <Text style={{ fontWeight: '700', color: C.vert, marginTop: 4 }}>{STATUTS[b.statut] ?? b.statut}</Text>
          <Muted>{b.poidsKg} kg {b.poidsReel ? '(pesé)' : '(déclaré)'}</Muted>
          <Frise statut={b.statut} />
          <T style={{ fontWeight: '700', marginTop: 4 }}>Points de passage ({b.scans.length})</T>
          {b.scans.length === 0 ? <Muted>En attente du premier scan en station.</Muted> : [...b.scans].reverse().map((s, i) => (
            <View key={i} style={{ flexDirection: 'row', marginTop: 6 }}>
              <Text style={{ color: C.vert, marginRight: 8 }}>●</Text>
              <View style={{ flex: 1 }}><T>{s.pointNom ?? STATUTS[s.etape] ?? s.etape}</T><Muted>{STATUTS[s.etape] ?? s.etape} · {s.station} · {heure(s.ts)}</Muted></View>
            </View>))}
          <Bouton titre="Signaler un problème" onPress={() => litige(b.code)} couleur={C.rouge} style={{ marginTop: 10 }} />
        </Carte>
      ))}
    </ScrollView>
  );
}

function Alertes({ d }) {
  return (<ScrollView contentContainerStyle={{ padding: 14 }}>
    <H>Alertes de suivi</H>
    {!d || d.notifications.length === 0 ? <Carte><Muted>Aucune alerte pour le moment. Vous en recevrez une à chaque scan de vos bagages.</Muted></Carte> : d.notifications.slice(0, 30).map((n, i) => (
      <Carte key={i} style={{ padding: 10 }}><Muted>{n.canal} · {heure(n.ts)}</Muted><T>{n.message}</T></Carte>))}
  </ScrollView>);
}
