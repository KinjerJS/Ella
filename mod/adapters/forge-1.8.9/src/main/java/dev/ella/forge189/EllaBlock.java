package dev.ella.forge189;

import dev.ella.core.SlotSettings;
import net.minecraft.block.Block;
import net.minecraft.block.material.Material;
import net.minecraft.block.properties.PropertyDirection;
import net.minecraft.block.state.BlockState;
import net.minecraft.block.state.IBlockState;
import net.minecraft.entity.Entity;
import net.minecraft.entity.EntityLivingBase;
import net.minecraft.util.AxisAlignedBB;
import net.minecraft.util.BlockPos;
import net.minecraft.util.EnumFacing;
import net.minecraft.util.EnumWorldBlockLayer;
import net.minecraft.world.Explosion;
import net.minecraft.world.IBlockAccess;
import net.minecraft.world.World;
import net.minecraftforge.fml.relauncher.Side;
import net.minecraftforge.fml.relauncher.SideOnly;

/**
 * A placeholder block whose behaviour comes from a {@link SlotSettings} object rather
 * than from constructor arguments.
 *
 * <p>This inversion is the whole trick. A stock block bakes hardness, render layer and
 * shape in at construction, so changing any of them means registering a new block — which
 * frozen registries forbid. Reading each property on demand means the launcher can change
 * them by writing to a field, and the next query picks it up.
 *
 * <p>Three differences from the 1.12.2 adapter, all forced by the older API and all
 * verified against the decompiled 1.8.9 sources rather than assumed:
 *
 * <ul>
 *   <li>{@code isOpaqueCube()} and {@code isFullCube()} take no block state. On 1.8.9 they
 *       are properties of the block itself, so a slot cannot vary them per state — which
 *       costs nothing here, since every Ella slot has exactly one meaningful appearance.
 *   <li>There is no {@code getBoundingBox}. Bounds are mutable fields set through
 *       {@link #setBlockBoundsBasedOnState}, which the game calls before it reads them.
 *   <li>Sound is a public field rather than a getter, so it is assigned rather than
 *       overridden — see {@link #applySound()}.
 * </ul>
 */
public class EllaBlock extends Block {

    /**
     * Stand-in used while {@link Block}'s constructor is still running.
     *
     * <p>{@code Block.<init>} builds its default block state, and that calls overridable
     * methods such as {@link #isOpaqueCube} <em>before</em> this class's fields are
     * assigned — so {@link #settings} is genuinely null for the duration of {@code super()}.
     * Reading it directly there throws, and the stack trace points at the override rather
     * than at the constructor that provoked it.
     *
     * <p>Shared and never mutated: it only ever supplies defaults during construction.
     */
    private static final SlotSettings DEFAULTS = new SlotSettings();

    private final SlotSettings settings;
    private final int slot;

    /**
     * Orientation, present on every slot.
     *
     * <p>State properties are baked into the {@link BlockState} at construction, exactly
     * like registry entries are frozen after startup. A slot that might later be made
     * rotatable therefore has to carry the property from the start; the {@code rotation}
     * setting only decides whether placement uses it.
     */
    public static final PropertyDirection FACING = PropertyDirection.create("facing");

    public EllaBlock(SlotSettings settings, int slot) {
        // Material.rock is only a starting point; the properties that matter are all
        // overridden below to read from `settings`.
        super(Material.rock);
        this.settings = settings;
        this.slot = slot;

        setHardness(1.5f);
        setResistance(6.0f);
        setDefaultState(this.blockState.getBaseState().withProperty(FACING, EnumFacing.NORTH));
    }

    // --- state ---------------------------------------------------------------

    @Override
    protected BlockState createBlockState() {
        return new BlockState(this, FACING);
    }

    @Override
    public IBlockState getStateFromMeta(int meta) {
        // Six directions fit in three bits; anything else is a corrupt value, so fall
        // back to north rather than throwing during world load.
        EnumFacing facing = EnumFacing.getFront(meta);
        return getDefaultState().withProperty(FACING, facing);
    }

    @Override
    public int getMetaFromState(IBlockState state) {
        return state.getValue(FACING).getIndex();
    }

    /**
     * Chooses the facing a newly placed block gets.
     *
     * <p>1.8.9's hook is {@code onBlockPlaced} rather than the {@code getStateForPlacement}
     * of later versions. With rotation off this always returns north, so the block renders
     * exactly as authored — the property exists but is never varied.
     */
    @Override
    public IBlockState onBlockPlaced(World world, BlockPos pos, EnumFacing face,
                                     float hitX, float hitY, float hitZ, int meta,
                                     EntityLivingBase placer) {
        String mode = live().rotation;

        if ("horizontal".equals(mode)) {
            // Facing the player, which is what furnaces and chests do.
            return getDefaultState().withProperty(FACING, placer.getHorizontalFacing().getOpposite());
        }
        if ("all".equals(mode)) {
            // The face that was clicked, like pistons.
            return getDefaultState().withProperty(FACING, face);
        }
        return getDefaultState().withProperty(FACING, EnumFacing.NORTH);
    }

    /**
     * The live settings, or shared defaults while the superclass constructor is running.
     * Every override below goes through this rather than touching the field.
     */
    private SlotSettings live() {
        SlotSettings current = settings;
        return current != null ? current : DEFAULTS;
    }

    public int slot() {
        return slot;
    }

    public SlotSettings settings() {
        return settings;
    }

    /**
     * Copies the slot's sound onto the block.
     *
     * <p>1.8.9 has no {@code getSoundType} hook — {@code stepSound} is a plain public
     * field the game reads directly, so keeping it current means assigning it whenever the
     * setting changes. Called from the host on every settings patch.
     */
    void applySound() {
        this.stepSound = Sounds.byName(live().soundType);
    }

    // --- appearance ---------------------------------------------------------

    /** 1.8.9 names both the method and the enum differently from later versions. */
    @Override
    @SideOnly(Side.CLIENT)
    public EnumWorldBlockLayer getBlockLayer() {
        String layer = live().renderLayer;
        if ("cutout".equals(layer)) return EnumWorldBlockLayer.CUTOUT;
        if ("cutout_mipped".equals(layer)) return EnumWorldBlockLayer.CUTOUT_MIPPED;
        if ("translucent".equals(layer)) return EnumWorldBlockLayer.TRANSLUCENT;
        return EnumWorldBlockLayer.SOLID;
    }

    /**
     * Controls whether neighbouring faces are culled. Returning false is what actually
     * makes a transparent block look transparent — the render layer alone is not enough,
     * which is the mistake the editor warns about.
     */
    @Override
    public boolean isOpaqueCube() {
        return live().opaque;
    }

    @Override
    public boolean isFullCube() {
        return live().fullCube;
    }

    @Override
    public int getLightValue(IBlockAccess world, BlockPos pos) {
        return live().lightLevel;
    }

    @Override
    public int getLightOpacity(IBlockAccess world, BlockPos pos) {
        // A non-opaque block must not block light, otherwise glass-like models render
        // with a black interior.
        return live().opaque ? 255 : 0;
    }

    // --- physical -----------------------------------------------------------

    @Override
    public float getBlockHardness(World world, BlockPos pos) {
        return live().hardness;
    }

    @Override
    public float getExplosionResistance(World world, BlockPos pos, Entity exploder,
                                        Explosion explosion) {
        // Minecraft stores resistance pre-divided by 5; the launcher exposes the value
        // players actually recognise, so convert here rather than in the editor.
        return live().resistance / 5.0f;
    }

    // --- shape --------------------------------------------------------------

    /**
     * 1.8.9 reads a block's shape from mutable fields rather than from a returned box, and
     * calls this first so the block can set them for the state at hand. Everything that
     * asks about our bounds therefore goes through here.
     */
    @Override
    public void setBlockBoundsBasedOnState(IBlockAccess world, BlockPos pos) {
        applyBounds();
    }

    @Override
    public void setBlockBoundsForItemRender() {
        applyBounds();
    }

    private void applyBounds() {
        if (!"custom".equals(live().collision)) {
            setBlockBounds(0.0f, 0.0f, 0.0f, 1.0f, 1.0f, 1.0f);
            return;
        }
        float[] box = live().hitboxNormalised();
        setBlockBounds(box[0], box[1], box[2], box[3], box[4], box[5]);
    }

    @Override
    public AxisAlignedBB getCollisionBoundingBox(World world, BlockPos pos, IBlockState state) {
        // Null is 1.8.9's "no collision at all", the equivalent of the later NULL_AABB.
        if ("none".equals(live().collision)) return null;
        applyBounds();
        return super.getCollisionBoundingBox(world, pos, state);
    }

    @Override
    public boolean shouldSideBeRendered(IBlockAccess world, BlockPos pos, EnumFacing side) {
        // Let two adjacent non-opaque blocks of the same kind still draw their shared
        // faces; hiding them is only correct for full opaque cubes.
        if (!live().opaque || !live().fullCube) return true;
        return super.shouldSideBeRendered(world, pos, side);
    }
}
