import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Vibration } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { api } from '../api';
import { C, heure, STATUTS } from '../theme';
import { Carte, H, T, Muted, Champ, Bouton, Erreur, Pill, Onglets, EnTete } from '../ui';
import Radar from './Radar';

export default function Agent({ jeton, utilisateur, quitter }) {
  const [onglet, setOnglet] = useState('scanner');
  return (
    <View style={{ flex: 1, backgroundColor: C.fond }}>
      <EnTete titre={utilisateur.nom} sous={`Agent · station ${utilisateur.station ?? '—'}`} onQuitter={quitter} />
      <View style={{ flex: 1 }}>
        {onglet === 'scanner' ? <Scanner jeton={jeton} /> : null}
        {onglet === 'radar' ? <Radar jeton={jeton} personnel /> : null}
        {onglet === 'passagers' ? <Passagers jeton={jeton} /> : null}
        {onglet === 'reclamations' ? <Reclamations jeton={jeton} /> : null}
      </View>
      <Onglets actif={onglet} onChange={setOnglet} onglets={[['scanner', '📷', 'Scanner'], ['radar', '🛰️', 'Radar'], ['passagers', '👥', 'Passagers'], ['reclamations', '📝', 'Réclamations']]} />
    </View>
  );
}

function Scanner({ jeton }) {
  const [perm, demander] = useCameraPermissions();
  const [points, setPoints] = useState([]);
  const [point, setPoint] = useState(null);
  const [code, setCode] = useState('');
  const [poids, setPoids] = useState('');
  const [cam, setCam] = useState(false);
  const [bag, setBag] = useState(null);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [att, setAtt] = useState(false);
  const [hist, setHist] = useState([]);
  const dernier = useRef({ c: '', t: 0 });

  useEffect(() => { api('GET', '/api/agent/points', null, jeton).then((l) => { setPoints(l); if (l[0]) setPoint(l[0]); }).catch((e) => setErr(e.message)); }, [jeton]);

  const chercher = useCallback(async (c) => {
    if (!c) return;
    try { setBag((await api('GET', `/api/agent/bagages/${encodeURIComponent(c)}`, null, jeton))); setErr(''); } catch (e) { setBag(null); setErr(e.message); }
  }, [jeton]);

  const valider = async (c = code) => {
    setErr(''); setRes(null);
    if (!point) return setErr('Choisissez un point de scan.');
    if (!c) return setErr('Scannez ou saisissez un code.');
    if (point.etape === 'ENREGISTRE' && !poids && !bag?.bagage?.poidsReel) return setErr('Saisissez le poids lu sur la balance.');
    setAtt(true);
    try {
      const r = await api('POST', '/api/agent/scans', { code: c, pointId: point.id, poidsKg: point.etape === 'ENREGISTRE' && poids ? poids : undefined }, jeton);
      setRes({ ok: true, texte: `${c} : ${r.bagage.libelle}`, avert: r.avertissement, fraude: r.fraude });
      if (r.fraude) Vibration.vibrate([0, 400, 150, 400, 150, 400]);
      setHist((h) => [{ ts: r.scan.ts, c, l: r.bagage.libelle, p: point.nom }, ...h].slice(0, 15));
      Vibration.vibrate(80);
      setCode(''); setPoids(''); setBag(null);
    } catch (e) { setErr(e.message); Vibration.vibrate([0, 200, 100, 200]); }
    setAtt(false);
  };

  const lu = ({ data }) => {
    const c = String(data ?? '').trim().toUpperCase();
    const now = Date.now();
    if (!c || (dernier.current.c === c && now - dernier.current.t < 3000)) return; // anti double-lecture
    dernier.current = { c, t: now };
    setCode(c); chercher(c);
    if (point && point.etape !== 'ENREGISTRE') { setCam(false); valider(c); }
    else setCam(false);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 14 }} keyboardShouldPersistTaps="handled">
      <Carte>
        <H>Point de scan</H>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>{points.map((p) => (
          <TouchableOpacity key={p.id} onPress={() => setPoint(p)} style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, marginRight: 6, backgroundColor: point?.id === p.id ? C.bleu2 : C.fond }}>
            <Text style={{ color: point?.id === p.id ? '#fff' : C.gris, fontWeight: '600' }}>{p.nom}</Text></TouchableOpacity>))}</ScrollView>
        {point ? <Muted style={{ marginTop: 6 }}>{point.station} · étape « {STATUTS[point.etape] ?? point.etape} »</Muted> : null}
      </Carte>
      <Carte>
        {cam ? (perm?.granted ? <View style={{ height: 260, borderRadius: 10, overflow: 'hidden', marginBottom: 10 }}>
          <CameraView style={{ flex: 1 }} facing="back" onBarcodeScanned={lu} barcodeScannerSettings={{ barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'ean8', 'datamatrix'] }} /></View>
          : <Bouton titre="Autoriser la caméra" onPress={demander} />) : null}
        <Bouton titre={cam ? 'Fermer la caméra' : '📷 Scanner une étiquette'} onPress={() => { if (!perm?.granted) demander(); setCam(!cam); }} couleur={cam ? C.gris : C.bleu2} />
        <View style={{ height: 10 }} />
        <Champ label="Code bagage (saisie manuelle)" value={code} onChangeText={(v) => setCode(v.toUpperCase())} onSubmitEditing={() => chercher(code)} autoCapitalize="characters" />
        {point?.etape === 'ENREGISTRE' ? <Champ label="Poids lu sur la balance (kg)" value={poids} onChangeText={setPoids} keyboardType="numeric" /> : null}
        <Erreur>{err}</Erreur>
        {res ? (res.fraude ? <View style={{ backgroundColor: '#c62828', padding: 12, borderRadius: 10, marginBottom: 8 }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>⚠ ALERTE FRAUDE (mbindiri) {res.fraude.numero}</Text><Text style={{ color: '#ffe0dd', marginTop: 4 }}>{res.avert}</Text></View> : <View style={{ backgroundColor: res.avert ? '#fff4e0' : '#e9f7ef', padding: 10, borderRadius: 8, marginBottom: 8 }}><T style={{ fontWeight: '700' }}>✔ {res.texte}</T>{res.avert ? <Muted>{res.avert}</Muted> : null}</View>) : null}
        <Bouton titre="Valider le scan" onPress={() => valider()} chargement={att} couleur={C.vert} />
      </Carte>
      {bag?.bagage ? <Carte><H>{bag.bagage.code}</H>
        <T>{bag.passager ?? bag.nom ?? ''} {bag.pnr ? `· ${bag.pnr}` : ''}</T>
        <T>{bag.bagage.poidsKg} kg · {STATUTS[bag.bagage.statut] ?? bag.bagage.statut}</T></Carte> : null}
      {hist.length ? <Carte><H>Derniers scans</H>{hist.map((h, i) => <Muted key={i}>{heure(h.ts)} · {h.c} · {h.l} · {h.p}</Muted>)}</Carte> : null}
    </ScrollView>
  );
}

function Passagers({ jeton }) {
  const [f, setF] = useState({ pnr: '', nom: '', classe: 'ECO', vol: '', date: '', telephone: '' });
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [pnr, setPnr] = useState(''); const [poids, setPoids] = useState(''); const [etiq, setEtiq] = useState(null);
  const m = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const creer = async () => {
    setErr(''); setMsg('');
    try { const r = await api('POST', '/api/agent/reservations', f, jeton); setMsg(`Réservation ${r.pnr} ${r.creee ? 'créée' : 'mise à jour'}.`); setPnr(r.pnr); }
    catch (e) { setErr(e.message); }
  };
  const etiquette = async () => {
    setErr(''); setEtiq(null);
    try { const r = await api('POST', '/api/agent/bagages', { pnr: pnr.trim(), poidsKg: poids }, jeton); setEtiq(r.code); }
    catch (e) { setErr(e.message); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 14 }} keyboardShouldPersistTaps="handled">
      <Erreur>{err}</Erreur>
      <Carte><H>Nouvelle réservation</H>
        <Champ label="Référence (PNR)" value={f.pnr} onChangeText={(v) => m('pnr')(v.toUpperCase())} autoCapitalize="characters" />
        <Champ label="Nom du passager" value={f.nom} onChangeText={m('nom')} autoCapitalize="words" />
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>{['ECO', 'BUSINESS', 'VIP'].map((c) => (
          <TouchableOpacity key={c} onPress={() => m('classe')(c)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: f.classe === c ? C.bleu2 : C.fond }}>
            <Text style={{ color: f.classe === c ? '#fff' : C.gris, fontWeight: '600' }}>{c}</Text></TouchableOpacity>))}</View>
        <Champ label="Numéro de vol" value={f.vol} onChangeText={(v) => m('vol')(v.toUpperCase())} autoCapitalize="characters" />
        <Champ label="Date (AAAA-MM-JJ)" value={f.date} onChangeText={m('date')} />
        <Champ label="Téléphone (alertes)" value={f.telephone} onChangeText={m('telephone')} keyboardType="phone-pad" />
        {msg ? <T style={{ color: C.vert, marginBottom: 6 }}>{msg}</T> : null}
        <Bouton titre="Enregistrer" onPress={creer} /></Carte>
      <Carte><H>Émettre une étiquette bagage</H>
        <Champ label="PNR" value={pnr} onChangeText={(v) => setPnr(v.toUpperCase())} autoCapitalize="characters" />
        <Champ label="Poids déclaré (kg)" value={poids} onChangeText={setPoids} keyboardType="numeric" />
        {etiq ? <View style={{ backgroundColor: '#e9f7ef', padding: 10, borderRadius: 8, marginBottom: 8 }}><Muted>Code étiquette</Muted><Text style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: '800' }}>{etiq}</Text></View> : null}
        <Bouton titre="Créer l’étiquette" onPress={etiquette} couleur={C.vert} /></Carte>
    </ScrollView>
  );
}

function Reclamations({ jeton }) {
  const [l, setL] = useState([]); const [err, setErr] = useState('');
  const charger = useCallback(() => api('GET', '/api/agent/reclamations', null, jeton).then(setL).catch((e) => setErr(e.message)), [jeton]);
  useEffect(() => { charger(); const i = setInterval(charger, 15000); return () => clearInterval(i); }, [charger]);
  const maj = async (numero, statut) => {
    try { await api('PATCH', `/api/agent/reclamations/${encodeURIComponent(numero)}`, { statut }, jeton); charger(); } catch (e) { setErr(e.message); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 14 }}>
      <Erreur>{err}</Erreur>
      <H>{l.length} réclamation(s)</H>
      {l.map((r) => (
        <Carte key={r.numero} style={r.priorite === 'PRIORITAIRE' && r.statut !== 'RESOLUE' ? { borderColor: C.orange, borderWidth: 2 } : null}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T style={{ fontWeight: '700' }}>{r.numero}</T>{r.priorite === 'PRIORITAIRE' ? <Pill texte="PRIORITAIRE · VIP" couleur={C.orange} /> : <Pill texte={r.libelleStatut} />}</View>
          <T>{r.nom} · vol {r.vol} · {r.date}</T>
          <Muted>PNR {r.reference} · billet {r.numeroBillet} · {r.verifiee ? 'vérifiée ✔' : 'à vérifier'} · {r.libelleStatut}</Muted>
          {r.description ? <T style={{ marginTop: 4 }}>{r.description}</T> : null}
          {r.statut !== 'RESOLUE' && r.statut !== 'REJETEE' ? <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            {r.statut === 'NOUVELLE' ? <Bouton titre="Prendre en charge" onPress={() => maj(r.numero, 'EN_COURS')} style={{ flex: 1 }} /> : null}
            <Bouton titre="Résolue" onPress={() => maj(r.numero, 'RESOLUE')} couleur={C.vert} style={{ flex: 1 }} />
          </View> : null}
        </Carte>))}
    </ScrollView>
  );
}
